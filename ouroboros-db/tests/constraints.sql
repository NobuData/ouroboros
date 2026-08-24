-- constraints.sql — the schema's acceptance criteria, as assertions.
--
-- Every rule the migrations claim to enforce, checked against a real PostgreSQL that has
-- had them applied. A migration can be syntactically fine, apply cleanly and still not
-- enforce what it was written for: a `unique` on the wrong columns, a cascade that was
-- left off, a check that accepts what it was meant to reject. `flyway validate` cannot
-- see any of that, because it compares checksums rather than behaviour.
--
-- Run it against a migrated database. It creates its own fixtures and rolls everything
-- back, so it leaves no rows behind and is safe to repeat:
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/constraints.sql
--
-- It exits non-zero on the first violated assertion, which is what makes it usable as a
-- CI step (issue #24 wires it into `ci/db`; the assertions themselves belong beside the
-- migrations that must satisfy them).
--
-- Covers the schema as V006 (#708) leaves it: the BetterAuth core tables (V004, #706),
-- the organization plugin's tables and the tenant pointer (V005, #707), and the three
-- extension tables V006 re-parented — `tenant_domains`, `github_orgs`, `github_repos`,
-- carrying V001's (#20) and V003's (#22) rules under their new parent. V002's tables,
-- and V001's `tenants`, no longer exist, and the last section asserts they stay gone.
-- What V006 *did to the rows it found* is asserted where it can be observed:
-- tests/rehearsal/, which applies it to a database seeded with the pre-migration seed.
-- The product tables added since stand on that base and have a section each:
-- `user_preferences` (V007, #649), the dashboard read-model — `runs` (V008, #64),
-- `queue_items` (V009, #65), `token_usage` (V010, #66) and `workspace_settings` (V011,
-- #67) — `model_prices` (V012, #580), `tenant_keys` (V013, #222), the intake mirror
-- `github_issues` with its sync cursor on `github_repos` (V014, #99), the routing
-- foundation `provider_connections` and `model_aliases` (V015, #189), the routing matrix
-- itself — `task_kinds`, `routes` and ordered `route_hops` (V016, #190) — what mockup
-- 07's provider cards show and the discovered catalog beneath them (V017, #221), the
-- `escalation_rules` that modify a route (V018, #191), the alias switch, unbound
-- binding and structured params mockup 21's registry manages (V019, #579), and
-- `route_revisions`, the audit trail one press of mockup 06's *Save routes* leaves behind
-- (V021, #195), and `audit_events`, the append-only credential trail #26 specified and
-- AD.4 landed early (V022, #225).
--
-- A migration that adds a rule adds its assertion here in the same change. What
-- R__dev_seed.sql (#23) *puts* in a development database is seed.sql beside this file;
-- what the schema refuses to let anything put there is here.

\set ON_ERROR_STOP on

-- Result rows go nowhere: a passing assertion returns void, so the only thing printed
-- would be a screenful of empty one-row tables. Errors are unaffected — they are raised
-- on stderr, and ON_ERROR_STOP still aborts the script and exits non-zero — so a failure
-- is the only thing this prints, which is what makes the CI log worth reading.
\o /dev/null

begin;

-- The assertion helpers, shared with seed.sql: must_hold, must_reject and
-- must_use_index, created in pg_temp so they disappear with the session. See
-- lib/assert.sql for what each one asserts and why it is not plpgsql's `assert`.
\ir lib/assert.sql

-- ---------------------------------------------------------------------------
-- A known-empty schema to build the fixtures in.
--
-- Every assertion below either counts rows or names one by its natural key, and both
-- only mean what they say if the tables start out empty. A development database is not:
-- since #23, R__dev_seed.sql puts the demo workspace into every database the compose
-- stack migrates — and it is drawn from the same mockups these fixtures are, so it holds
-- the same slug, the same domain and the same email addresses.
--
-- Clearing is the fix rather than renaming the fixtures: a rename would leave the
-- absolute counts quietly measuring the seed as well, and would have to be done again
-- the next time a seed grows into a name used here.
--
-- Nothing is lost. This is inside the transaction the end of the script rolls back, so
-- every row deleted here is restored on the way out — which is what keeps this safe to
-- run against a database somebody is using. Two deletes cover the whole schema now:
-- `session` and `account` cascade from `"user"`; `member`, `invitation`,
-- `tenant_domains` and `github_orgs` cascade from `organization` (and `member` and
-- `invitation` from `"user"` as well); `github_repos` cascades from `github_orgs`.
-- `verification` holds no fixture and none of these assertions read it.
--
-- `"user"` quoted, like every other reference to it in this repository: unquoted it is
-- the SQL keyword.
-- ---------------------------------------------------------------------------
delete from ouroboros."user";
delete from ouroboros.organization;

-- ---------------------------------------------------------------------------
-- Fixtures. Fixed ids so an assertion can name a row without a lookup.
--
-- Text ids on the BetterAuth tables, because that is the type the library writes and
-- V006 preserved — asserting against the type the application actually uses is the
-- point. The extension tables keep their uuid surrogates from V001/V003.
--
-- Ken belongs to both organizations with a different role in each — the multi-workspace
-- criterion is asserted against this pairing rather than a row made for it. `aaaa…` is a
-- throwaway whose deletion is what the user-cascade assertions observe.
-- ---------------------------------------------------------------------------
insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata") values
  ('org-acme',   'Acme Robotics', 'acme-robotics', now(), null),
  ('org-globex', 'Globex',        'globex',        now(), null);

insert into ouroboros."user" ("id", "name", "email", "emailVerified", "image") values
  ('66666666-6666-6666-6666-666666666666', 'Ken S',       'ken@acme-robotics.dev',  true,  'https://avatars.example/ken.png'),
  ('77777777-7777-7777-7777-777777777777', 'Maya Chen',   'maya@acme-robotics.dev', true,  null),
  ('88888888-8888-8888-8888-888888888888', 'Jorge Reyes', 'jorge@globex.example',   false, null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Temp Person', 'temp@acme-robotics.dev', true,  null);

insert into ouroboros.account ("id", "accountId", "providerId", "userId", "updatedAt") values
  ('acct-ken',  '1001', 'github', '66666666-6666-6666-6666-666666666666', now()),
  ('acct-maya', '1002', 'github', '77777777-7777-7777-7777-777777777777', now()),
  ('acct-temp', '1003', 'github', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());

insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt") values
  ('mem-acme-ken',    'org-acme',   '66666666-6666-6666-6666-666666666666', 'owner',  now()),
  ('mem-acme-maya',   'org-acme',   '77777777-7777-7777-7777-777777777777', 'admin',  now()),
  ('mem-acme-temp',   'org-acme',   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer', now()),
  ('mem-globex-ken',  'org-globex', '66666666-6666-6666-6666-666666666666', 'viewer', now()),
  ('mem-globex-jorge','org-globex', '88888888-8888-8888-8888-888888888888', 'member', now());

insert into ouroboros.tenant_domains (organization_id, domain, is_primary) values
  ('org-acme', 'acme-robotics.dev', true),
  ('org-acme', 'acme.example',      false);

insert into ouroboros.github_orgs (id, organization_id, login, enabled) values
  ('33333333-3333-3333-3333-333333333333', 'org-acme',   'acme-robotics', true),
  ('44444444-4444-4444-4444-444444444444', 'org-globex', 'globex-inc',    false);

insert into ouroboros.github_repos (org_id, name, enabled, default_branch) values
  ('33333333-3333-3333-3333-333333333333', 'helios-firmware', true,  'main'),
  ('33333333-3333-3333-3333-333333333333', 'atlas-control',   false, null);

-- ===========================================================================
-- tenant_domains — V001's rules (#20), under the parent V006 gave them (#708)
-- ===========================================================================

-- Acceptance criterion (#708): a duplicate domain across organizations is rejected —
-- a domain resolves exactly one workspace at sign-in.
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_domains (organization_id, domain)
    values ('org-globex', 'acme-robotics.dev')$$,
  'tenant_domains.domain is unique across organizations', 'tenant_domains_domain_key');

-- Domains are stored folded, so the unique index is also the case-insensitive rule.
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_domains (organization_id, domain)
    values ('org-globex', 'Globex.Example')$$,
  'tenant_domains.domain must be stored lower-cased', 'tenant_domains_domain_format');

-- One primary domain per organization — V001's partial unique index, re-scoped by V006 —
-- and zero is legal, so a workspace mid-setup is representable.
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_domains (organization_id, domain, is_primary)
    values ('org-acme', 'acme-second.example', true)$$,
  'at most one primary domain per organization', 'tenant_domains_one_primary_per_organization');

insert into ouroboros.tenant_domains (organization_id, domain, is_primary)
  values ('org-globex', 'globex.example', false);
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.tenant_domains
   where organization_id = 'org-globex' and is_primary),
  'an organization with no primary domain is representable');

-- A domain must belong to an organization that exists, and a deleted organization takes
-- its domains with it (the cascade is exercised in the V006 section below).
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_domains (organization_id, domain)
    values ('no-such-org', 'orphan.example')$$,
  'tenant_domains.organization_id references an existing organization',
  'tenant_domains_organization_id_fkey');

-- Acceptance criterion (#708): the sign-in lookup — and #712's discovery endpoint —
-- resolve the workspace by domain on every sign-in, so it must not be a scan.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select organization_id from ouroboros.tenant_domains where domain = lower('Acme-Robotics.dev')$$,
  'tenant_domains_domain_key');

-- Listing an organization's domains is the other access path; the unique index above is
-- keyed on `domain`, so it cannot serve it.
select pg_temp.must_use_index(
  $$select domain from ouroboros.tenant_domains where organization_id = 'org-acme'$$,
  'tenant_domains_organization_id_idx');
set local enable_seqscan = on;

-- updated_at is maintained by the trigger, and the server clock wins over the statement.
--
-- Backdated first, because `now()` is the *transaction* timestamp: every default and
-- every trigger firing in this script sees the same instant, so a freshly inserted row
-- has updated_at = created_at and no update inside this transaction can make one exceed
-- the other. Starting from a stale value is what makes the trigger's effect visible —
-- and it is the stronger assertion anyway, since it also proves the trigger overrides a
-- value the statement supplied rather than merely filling in an absent one.
update ouroboros.tenant_domains set updated_at = '2000-01-01T00:00:00Z'
  where domain = 'acme-robotics.dev';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.tenant_domains
   where domain = 'acme-robotics.dev'),
  'tenant_domains.updated_at is stamped from the server clock by its touch trigger');

-- ===========================================================================
-- github_orgs & github_repos — V003's rules (#22), under the V006 parent (#708)
-- ===========================================================================

-- Acceptance criterion: unique org per workspace — V003's (tenant_id, login), restated
-- by V006 as (organization_id, login).
select pg_temp.must_reject(
  $$insert into ouroboros.github_orgs (organization_id, login)
    values ('org-acme', 'acme-robotics')$$,
  'github_orgs.login is unique within an organization', 'github_orgs_org_login_key');

-- Scoped per workspace, not globally — two organizations may each enable the same org.
insert into ouroboros.github_orgs (organization_id, login)
  values ('org-globex', 'acme-robotics');
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.github_orgs where login = 'acme-robotics'),
  'the same org login may be enabled by two different organizations');

-- Logins are folded, so the unique key is case-insensitive in effect.
select pg_temp.must_reject(
  $$insert into ouroboros.github_orgs (organization_id, login)
    values ('org-acme', 'Acme-Robotics')$$,
  'github_orgs.login must be stored lower-cased', 'github_orgs_login_format');

-- An org must belong to an organization that exists.
select pg_temp.must_reject(
  $$insert into ouroboros.github_orgs (organization_id, login)
    values ('no-such-org', 'orphan-org')$$,
  'github_orgs.organization_id references an existing organization',
  'github_orgs_organization_id_fkey');

-- Acceptance criterion: unique repo per org.
select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name)
    values ('33333333-3333-3333-3333-333333333333', 'helios-firmware')$$,
  'github_repos.name is unique within an org', 'github_repos_org_name_key');

-- Scoped per org — the same repo name under a different org is a different repo.
insert into ouroboros.github_repos (org_id, name)
  values ('44444444-4444-4444-4444-444444444444', 'helios-firmware');
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.github_repos where name = 'helios-firmware'),
  'the same repo name may exist under two different orgs');

select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name)
    values ('33333333-3333-3333-3333-333333333333', 'Atlas-Control')$$,
  'github_repos.name must be stored lower-cased', 'github_repos_name_format');

select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name)
    values ('33333333-3333-3333-3333-333333333333', '..')$$,
  'github_repos.name rejects path traversal', 'github_repos_name_format');

select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name)
    values ('99999999-9999-9999-9999-999999999999', 'orphan-repo')$$,
  'github_repos.org_id references an existing org', 'github_repos_org_id_fkey');

-- default_branch is nullable, and the shapes it accepts and refuses. The traversal and
-- whitespace cases are the ones that matter: the value reaches a command line and a
-- checkout path.
insert into ouroboros.github_repos (org_id, name, default_branch) values
  ('33333333-3333-3333-3333-333333333333', 'branch-ok-simple',  'main'),
  ('33333333-3333-3333-3333-333333333333', 'branch-ok-nested',  'release/2.0'),
  ('33333333-3333-3333-3333-333333333333', 'branch-ok-absent',  null);
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.github_repos where name like 'branch-ok-%'),
  'github_repos.default_branch accepts a simple name, a nested one, and null');

select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name, default_branch)
    values ('33333333-3333-3333-3333-333333333333', 'bad-branch-a', 'refs//heads')$$,
  'github_repos.default_branch rejects an empty path segment', 'github_repos_default_branch_format');
select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name, default_branch)
    values ('33333333-3333-3333-3333-333333333333', 'bad-branch-b', '../../etc/passwd')$$,
  'github_repos.default_branch rejects path traversal', 'github_repos_default_branch_format');
select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name, default_branch)
    values ('33333333-3333-3333-3333-333333333333', 'bad-branch-c', '/main')$$,
  'github_repos.default_branch rejects a leading slash', 'github_repos_default_branch_format');
select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name, default_branch)
    values ('33333333-3333-3333-3333-333333333333', 'bad-branch-d', 'main/')$$,
  'github_repos.default_branch rejects a trailing slash', 'github_repos_default_branch_format');
select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name, default_branch)
    values ('33333333-3333-3333-3333-333333333333', 'bad-branch-e', 'main; rm -rf /')$$,
  'github_repos.default_branch rejects shell metacharacters and whitespace', 'github_repos_default_branch_format');
select pg_temp.must_reject(
  $$insert into ouroboros.github_repos (org_id, name, default_branch)
    values ('33333333-3333-3333-3333-333333333333', 'bad-branch-f', '')$$,
  'github_repos.default_branch rejects the empty string — absent is null', 'github_repos_default_branch_format');

-- Enablement fails closed: a row inserted without an explicit flag is off.
insert into ouroboros.github_orgs (id, organization_id, login)
  values ('55555555-5555-5555-5555-555555555555', 'org-globex', 'defaults-org');
insert into ouroboros.github_repos (org_id, name)
  values ('55555555-5555-5555-5555-555555555555', 'defaults-repo');
select pg_temp.must_hold(
  (select not enabled from ouroboros.github_orgs
   where id = '55555555-5555-5555-5555-555555555555'),
  'github_orgs.enabled defaults to false');
select pg_temp.must_hold(
  (select not enabled from ouroboros.github_repos
   where org_id = '55555555-5555-5555-5555-555555555555' and name = 'defaults-repo'),
  'github_repos.enabled defaults to false');
select pg_temp.must_hold(
  (select installed_at is null from ouroboros.github_orgs
   where id = '55555555-5555-5555-5555-555555555555'),
  'github_orgs.installed_at is null until an installation happens');

-- The org flag does not overwrite the repo flags: an enabled repo under a disabled org
-- is representable, and in scope only because a caller must find both true.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_repos r
     join ouroboros.github_orgs o on o.id = r.org_id
   where o.organization_id = 'org-acme'
     and o.enabled and r.enabled),
  'scope is the intersection of the org flag and the repo flag');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_repos r
     join ouroboros.github_orgs o on o.id = r.org_id
   where o.id = '44444444-4444-4444-4444-444444444444' and not o.enabled),
  'a disabled org keeps its repo rows rather than discarding them');

-- Both tables carry the same touch trigger as tenant_domains, sharing one function.
update ouroboros.github_orgs set updated_at = '2000-01-01T00:00:00Z'
  where id = '33333333-3333-3333-3333-333333333333';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.github_orgs
   where id = '33333333-3333-3333-3333-333333333333'),
  'github_orgs.updated_at is stamped by its touch trigger');

update ouroboros.github_repos set updated_at = '2000-01-01T00:00:00Z'
  where org_id = '33333333-3333-3333-3333-333333333333' and name = 'helios-firmware';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.github_repos
   where org_id = '33333333-3333-3333-3333-333333333333' and name = 'helios-firmware'),
  'github_repos.updated_at is stamped by its touch trigger');

-- Listing an organization's orgs, and an org's repos, must not be condemned to a scan
-- either; both are served by the leading column of their unique key.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select id from ouroboros.github_orgs where organization_id = 'org-acme'$$,
  'github_orgs_org_login_key');
select pg_temp.must_use_index(
  $$select id from ouroboros.github_repos where org_id = '33333333-3333-3333-3333-333333333333'$$,
  'github_repos_org_name_key');
set local enable_seqscan = on;

-- ===========================================================================
-- V004 — BetterAuth core schema (#706)
-- ===========================================================================
--
-- The four vendor-shaped tables, and the rules V004 added to the ones the library
-- emitted. What V004's *back-fill* did is no longer assertable here — V006 dropped the
-- function with the tables it read — so what remains is the schema half: names, casing,
-- uniqueness, referential integrity, indexes and cascades.

-- --- the tables exist, under the names the library looks for ----------------
--
-- `to_regclass` answers null rather than raising for a name that resolves to nothing,
-- which is what lets a missing table be a named assertion failure instead of an aborted
-- script. The literal is double-quoted *inside* the string, because that is the only
-- spelling PostgreSQL resolves: `ouroboros.user` unquoted is the `user` keyword.
select pg_temp.must_hold(
  (select to_regclass('ouroboros."user"') is not null),
  'V004 created ouroboros."user" — the quoted, reserved-word table name');
select pg_temp.must_hold(
  (select count(*) = 4 from information_schema.tables
   where table_schema = 'ouroboros'
     and table_name in ('user', 'session', 'account', 'verification')),
  'V004 created all four BetterAuth core tables');

-- The library's column names are kept exactly as generated — roadmap decision A4. A
-- migration that "tidied" `emailVerified` into `email_verified` would apply cleanly and
-- then fail on the first sign-in, so the casing is asserted rather than assumed.
select pg_temp.must_hold(
  (select count(*) = 5 from information_schema.columns
   where table_schema = 'ouroboros' and table_name = 'user'
     and column_name in ('id', 'name', 'email', 'emailVerified', 'image')),
  '"user" keeps BetterAuth''s camelCase column names');

-- The one place in this schema where a credential may live, stated as a decision rather
-- than left as an absence. `account` is the library's table, the columns are its
-- contract, and BetterAuth encrypts the tokens with BETTER_AUTH_SECRET before they are
-- written. The V006 section below asserts the mirror image — that no such column exists
-- on the tables this repository shapes.
select pg_temp.must_hold(
  (select count(*) = 3 from information_schema.columns
   where table_schema = 'ouroboros' and table_name = 'account'
     and column_name in ('accessToken', 'refreshToken', 'password')),
  'account is the one table that holds credentials, and holds all three columns for them');

-- --- uniqueness -------------------------------------------------------------
--
-- The three rules the acceptance criteria name. Each is asserted by the statement it
-- must refuse, with the constraint that has to be the one to fire — without naming it, a
-- row rejected by some unrelated not-null would read as a pass.
select pg_temp.must_reject(
  $$insert into ouroboros."user" ("id", "name", "email", "emailVerified", "updatedAt")
    values ('impostor', 'Impostor', 'ken@acme-robotics.dev', false, now())$$,
  '"user".email is unique across the installation', 'user_email_key');

insert into ouroboros.session ("id", "userId", "token", "expiresAt", "updatedAt")
  values ('session-1', '66666666-6666-6666-6666-666666666666', 'token-1',
          now() + interval '7 days', now());
select pg_temp.must_reject(
  $$insert into ouroboros.session ("id", "userId", "token", "expiresAt", "updatedAt")
    values ('session-2', '77777777-7777-7777-7777-777777777777', 'token-1',
            now() + interval '7 days', now())$$,
  'session.token is unique — two sessions cannot share a cookie', 'session_token_key');

-- The rule V004 adds that the library does not emit: one GitHub account belongs to one
-- person, and `findOAuthUser` looks a sign-in up by exactly this pair.
select pg_temp.must_reject(
  $$insert into ouroboros.account ("id", "accountId", "providerId", "userId", "updatedAt")
    values ('second-claim', '1001', 'github',
            '77777777-7777-7777-7777-777777777777', now())$$,
  'account(providerId, accountId) is unique — one GitHub account is one person',
  'account_provider_account_key');

-- Scoped by provider: two providers may independently issue the id `1001`, and those
-- are not the same account.
insert into ouroboros.account ("id", "accountId", "providerId", "userId", "updatedAt")
  values ('other-provider', '1001', 'credential',
          '77777777-7777-7777-7777-777777777777', now());
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.account where "accountId" = '1001'),
  'the same accountId under a different providerId is a different account');

-- --- referential integrity --------------------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.session ("id", "userId", "token", "expiresAt", "updatedAt")
    values ('orphan', 'nobody', 'token-orphan', now() + interval '1 day', now())$$,
  'session.userId references an existing "user"', 'session_userId_fkey');
select pg_temp.must_reject(
  $$insert into ouroboros.account ("id", "accountId", "providerId", "userId", "updatedAt")
    values ('orphan', '2002', 'github', 'nobody', now())$$,
  'account.userId references an existing "user"', 'account_userId_fkey');

-- --- indexes ----------------------------------------------------------------
--
-- The two reads every request makes now that #703's database-backed sessions are on:
-- the session by its cookie, and — on a sign-in — the account by provider and id. Both
-- must be served by an index at production size, which is what these assert; as
-- elsewhere in this file, the planner is stopped from preferring a scan over a
-- fixture-sized table.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select "userId" from ouroboros.session where "token" = 'token-1'$$,
  'session_token_key');
select pg_temp.must_use_index(
  $$select "userId" from ouroboros.account where "providerId" = 'github' and "accountId" = '1001'$$,
  'account_provider_account_key');
select pg_temp.must_use_index(
  $$select "id" from ouroboros."user" where "email" = 'ken@acme-robotics.dev'$$,
  'user_email_key');
set local enable_seqscan = on;

-- --- cascades ---------------------------------------------------------------
--
-- Deleting a person ends their sessions and removes the accounts that authenticated
-- them, in the same statement. A session row outliving its user would be a cookie that
-- resolves to nobody — a 500 rather than a sign-out — and an orphaned account row would
-- keep its (providerId, accountId) pair reserved against the unique index above, so that
-- GitHub account could never sign in again.
--
-- (Ken's memberships go with him too — that is V005's cascade, asserted in its own
-- section against a person deleted there.)
delete from ouroboros."user" where "id" = '66666666-6666-6666-6666-666666666666';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.session
   where "userId" = '66666666-6666-6666-6666-666666666666'),
  'deleting a "user" cascades to their sessions');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.account
   where "userId" = '66666666-6666-6666-6666-666666666666'),
  'deleting a "user" cascades to their accounts');

-- ===========================================================================
-- V005 — the organization plugin's schema, and the tenant pointer (#707)
-- ===========================================================================
--
-- Three tables and one column, and the rules V005 adds to the ones the library emitted.
-- The state this section starts from is what the section above left: Ken (`6666…`) is
-- deleted — taking `mem-acme-ken` and `mem-globex-ken` with him — so Maya (`7777…`),
-- Jorge (`8888…`) and the throwaway (`aaaa…`) remain, and `org-acme` holds Maya (admin)
-- and the throwaway (viewer).
--
-- What is *not* asserted here is anything about roles. `member.role` is deliberately not
-- CHECK-constrained (see V005), so the vocabulary is ouroboros-rest's to enforce and
-- #715's to assert; a test here would be testing a rule this schema does not make.

-- --- the tables exist, with the library's names and casing --------------------
select pg_temp.must_hold(
  (select count(*) = 3 from information_schema.tables
   where table_schema = 'ouroboros'
     and table_name in ('organization', 'member', 'invitation')),
  'V005 created all three organization-plugin tables');

-- Roadmap decision A4, asserted rather than assumed, exactly as the V004 section asserts
-- it for `"user"`. A migration that "tidied" `organizationId` into `organization_id`
-- would apply cleanly and then fail on the first organization anybody created.
select pg_temp.must_hold(
  (select count(*) = 4 from information_schema.columns
   where table_schema = 'ouroboros' and table_name = 'member'
     and column_name in ('id', 'organizationId', 'userId', 'role')),
  'member keeps BetterAuth''s camelCase column names');

-- #724's column, present now rather than then — the acceptance criterion that V005 is
-- what unblocks the invitation flow rather than merely preceding it.
select pg_temp.must_hold(
  (select count(*) = 1 from information_schema.columns
   where table_schema = 'ouroboros' and table_name = 'invitation'
     and column_name = 'expiresAt' and data_type = 'timestamp with time zone'),
  'invitation.expiresAt is present, and is a timestamptz — #724 depends on it');

-- --- metadata round-trips the `personal` flag --------------------------------
--
-- The thing mockup 01 Step 2's pill is rendered from. Read back through `::jsonb`
-- because that is the question being asked — not "is this the string I wrote" but "is
-- this JSON somebody can get the flag out of".
insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata")
  values ('org-personal', 'Maya Chen', 'maya-chen', now(), '{"personal": true}');
insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
  values ('mem-personal', 'org-personal', '77777777-7777-7777-7777-777777777777', 'owner', now());

select pg_temp.must_hold(
  (select ("metadata"::jsonb ->> 'personal')::boolean
   from ouroboros.organization where "id" = 'org-personal'),
  'organization.metadata round-trips the personal flag');
select pg_temp.must_hold(
  (select "metadata" is null from ouroboros.organization where "id" = 'org-acme'),
  'an organization with no metadata holds null rather than an empty object');

-- The column is JSON text by contract, so a value that is not JSON is a row the library
-- throws on the next time it reads the organization. This is the OURS constraint in the
-- migration, and the failure it exists to catch is a hand-written insert rather than
-- anything the plugin does.
select pg_temp.must_reject(
  $$insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata")
    values ('org-broken', 'Broken', 'broken', now(), 'personal: true')$$,
  'organization.metadata refuses text that is not JSON', 'organization_metadata_is_json');

-- And it is `is json`, not `is json object` — the text `null` is what the adapter writes
-- when a caller clears the field, and rejecting it would be this constraint inventing a
-- rule the library does not have.
insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata")
  values ('org-cleared', 'Cleared', 'cleared', now(), 'null');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization where "id" = 'org-cleared'),
  'organization.metadata accepts the JSON null the adapter writes when clearing it');

-- --- uniqueness ---------------------------------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.organization ("id", "name", "slug", "createdAt")
    values ('org-impostor', 'Impostor', 'acme-robotics', now())$$,
  'organization.slug is unique across the installation', 'organization_slug_key');

-- The successor to V002's composite primary key. The plugin refuses a second membership
-- in application code; this is what makes the rule hold under two concurrent invitation
-- accepts, which its read-then-write cannot close.
select pg_temp.must_reject(
  $$insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
    values ('mem-twice', 'org-acme', '77777777-7777-7777-7777-777777777777', 'owner', now())$$,
  'member(organizationId, userId) is unique — one person joins one organization once',
  'member_organization_user_key');

-- Scoped to the organization, which is the whole point: the same person holding a role
-- in a second organization is the case mockup 01 Step 2 exists to render.
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.member
   where "userId" = '77777777-7777-7777-7777-777777777777'),
  'one person may be a member of several organizations');

-- --- referential integrity ----------------------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
    values ('mem-orphan', 'no-such-org', '77777777-7777-7777-7777-777777777777', 'member', now())$$,
  'member.organizationId references an existing organization', 'member_organizationId_fkey');
select pg_temp.must_reject(
  $$insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
    values ('mem-orphan', 'org-acme', 'nobody', 'member', now())$$,
  'member.userId references an existing "user"', 'member_userId_fkey');
select pg_temp.must_reject(
  $$insert into ouroboros.invitation
      ("id", "organizationId", "email", "status", "expiresAt", "inviterId")
    values ('inv-orphan', 'org-acme', 'new@acme-robotics.dev', 'pending',
            now() + interval '7 days', 'nobody')$$,
  'invitation.inviterId references an existing "user"', 'invitation_inviterId_fkey');

-- --- the tenant pointer -------------------------------------------------------
--
-- OURS, all of it: the library emits a bare `text` column and clears it in application
-- code. These are the three properties the acceptance criterion asks the *schema* for.

-- Nullable, because a session exists from the moment somebody signs in — which is before
-- they have chosen anything in mockup 01 Step 2.
insert into ouroboros.session ("id", "userId", "token", "expiresAt", "updatedAt")
  values ('session-nowhere', '77777777-7777-7777-7777-777777777777', 'token-nowhere',
          now() + interval '7 days', now());
select pg_temp.must_hold(
  (select "activeOrganizationId" is null from ouroboros.session where "id" = 'session-nowhere'),
  'a new session starts with no active organization, and the column permits it');

-- A foreign key, so no session can point at an organization that does not exist. Without
-- it, a delete issued by anything other than the plugin — a support script, psql —
-- leaves sessions resolving a tenant that cannot be read.
select pg_temp.must_reject(
  $$update ouroboros.session set "activeOrganizationId" = 'no-such-org'
    where "id" = 'session-nowhere'$$,
  'session.activeOrganizationId references an existing organization',
  'session_activeOrganizationId_fkey');

update ouroboros.session set "activeOrganizationId" = 'org-acme' where "id" = 'session-nowhere';
select pg_temp.must_hold(
  (select "activeOrganizationId" = 'org-acme' from ouroboros.session
   where "id" = 'session-nowhere'),
  'setting the active organization is an ordinary update once the id exists');

-- --- indexes ------------------------------------------------------------------
--
-- The reads the product actually makes, one per index that has to exist for them:
-- mockup 01 Step 2's "which organizations is this person in", mockup 17's "who is in
-- this organization", the plugin's own `checkMembership` — the pair lookup behind every
-- role decision — and the workspace by its slug. These are also the shapes
-- modules/tenancy's #714 rewrite will issue, which is what "the schema supports the
-- rewrite" means in practice.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select "organizationId" from ouroboros.member
    where "userId" = '77777777-7777-7777-7777-777777777777'$$,
  'member_userId_idx');
select pg_temp.must_use_index(
  $$select "userId" from ouroboros.member where "organizationId" = 'org-acme'$$,
  'member_organizationId_idx');
select pg_temp.must_use_index(
  $$select "role" from ouroboros.member
    where "organizationId" = 'org-acme'
      and "userId" = '77777777-7777-7777-7777-777777777777'$$,
  'member_organization_user_key');
select pg_temp.must_use_index(
  $$select "id" from ouroboros.organization where "slug" = 'acme-robotics'$$,
  'organization_slug');

-- Not a read this service makes — the pointer is reached from a session already in
-- hand, by primary key. What needs the index is the foreign key itself: without one,
-- every delete of an organization scans `session` in full to find the rows to null out.
select pg_temp.must_use_index(
  $$select "id" from ouroboros.session where "activeOrganizationId" = 'org-acme'$$,
  'session_activeOrganizationId_idx');
set local enable_seqscan = on;

-- ===========================================================================
-- V006 — the cut-over is complete, and it holds (#708)
-- ===========================================================================

-- --- the dropped generation stays gone ----------------------------------------
--
-- The acceptance criterion in its own words: no table named `tenants`, `tenant_members`,
-- `users` or `user_identities` remains — and `ci/db` fails if one reappears, because
-- this file runs on every pull request against a freshly migrated database, so a
-- migration that recreated any of them fails here. `to_regclass` resolves *any*
-- relation, so a view smuggled in under one of the old names fails it too.
select pg_temp.must_hold(
  (select to_regclass('ouroboros.tenants')         is null
      and to_regclass('ouroboros.tenant_members')  is null
      and to_regclass('ouroboros.users')           is null
      and to_regclass('ouroboros.user_identities') is null),
  'no relation named tenants, tenant_members, users or user_identities remains');

-- The back-fill function went with the tables it read (V004 said this drop was #708's
-- to make). A recreated one would read tables that do not exist, so its absence is part
-- of the same criterion.
select pg_temp.must_hold(
  (select count(*) = 0 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'ouroboros' and p.proname = 'backfill_betterauth_core'),
  'the V004 back-fill function was dropped with the tables it read');

-- --- no credentials on our tables, asserted rather than trusted ----------------
--
-- V002's rule, surviving the tables it was written for: the tables this repository
-- shapes hold no token, secret or credential — `account` is the one place such a value
-- may live (asserted in the V004 section), and it is the library's table. Read from the
-- catalogue so the check keeps holding against a column added later, which a fixed list
-- of expected columns would not.
select pg_temp.must_hold(
  (select count(*) = 0 from information_schema.columns
   where table_schema = 'ouroboros'
     and table_name in ('tenant_domains', 'github_orgs', 'github_repos')
     and column_name ~ '(token|secret|credential|password|passwd|_key$)'),
  'the extension tables store no token, secret or credential column');

-- And the old parent is really gone from the survivors: the only parent column either
-- extension table carries is the one V006 gave it.
select pg_temp.must_hold(
  (select count(*) = 0 from information_schema.columns
   where table_schema = 'ouroboros'
     and table_name in ('tenant_domains', 'github_orgs')
     and column_name = 'tenant_id'),
  'tenant_id is gone from the re-parented extension tables');

-- --- the cascade, end to end ---------------------------------------------------
--
-- Acceptance criterion: delete organization → domains, and github_orgs → github_repos.
-- One statement, every hop observed. `org-acme` currently holds two domains, one GitHub
-- org (`3333…`) with five repos under it, two memberships (Maya, and the throwaway) and
-- one invitation; `session-nowhere` points at it.
insert into ouroboros.invitation
    ("id", "organizationId", "email", "role", "status", "expiresAt", "inviterId")
  values ('inv-acme', 'org-acme', 'new@acme-robotics.dev', 'member', 'pending',
          now() + interval '7 days', '77777777-7777-7777-7777-777777777777');

delete from ouroboros.organization where "id" = 'org-acme';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.tenant_domains where organization_id = 'org-acme'),
  'deleting an organization cascades to its tenant_domains');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_orgs where organization_id = 'org-acme'),
  'deleting an organization cascades to its github_orgs');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_repos
   where org_id = '33333333-3333-3333-3333-333333333333'),
  'deleting an organization cascades through its orgs to their github_repos');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.member where "organizationId" = 'org-acme'),
  'deleting an organization cascades to its memberships');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.invitation where "organizationId" = 'org-acme'),
  'deleting an organization cascades to its invitations');

-- **And it must not sign anybody out.** This is the difference between `set null` and
-- `cascade`, and it is the criterion that would be most expensive to get wrong: a
-- cascade here would delete the *session rows*, so deleting an organization would sign
-- out everybody who happened to be acting in it — including people whose other
-- memberships are untouched.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.session where "id" = 'session-nowhere'),
  'deleting an organization does not delete the sessions that pointed at it');
select pg_temp.must_hold(
  (select "activeOrganizationId" is null from ouroboros.session where "id" = 'session-nowhere'),
  'deleting an organization nulls the pointer — signed in, acting nowhere');

-- The people survive too: a membership is deleted, the member is not.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros."user"
   where "id" = '77777777-7777-7777-7777-777777777777'),
  'deleting an organization leaves its members'' "user" rows alone');

-- The cascade is scoped, not a table sweep: the other workspace keeps its rows.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.github_orgs where organization_id = 'org-globex'),
  'deleting one organization leaves another organization''s orgs alone');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_domains where organization_id = 'org-globex'),
  'and leaves its domains alone');

-- Deleting one GitHub org cascades to its repos without touching the workspace.
delete from ouroboros.github_orgs where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_repos
   where org_id = '44444444-4444-4444-4444-444444444444'),
  'deleting an org cascades to its github_repos');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization where "id" = 'org-globex'),
  'deleting an org does not delete its organization');

-- The cascade in the other direction: deleting a person takes their memberships with
-- them and leaves the organizations standing, since an organization outlives any one
-- member.
delete from ouroboros."user" where "id" = '77777777-7777-7777-7777-777777777777';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.member
   where "userId" = '77777777-7777-7777-7777-777777777777'),
  'deleting a "user" cascades to their memberships');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization where "id" = 'org-personal'),
  'deleting a "user" leaves the organizations they belonged to standing');

-- ===========================================================================
-- The vendor surface the drift check cannot see (#710)
-- ===========================================================================
--
-- `scripts/betterauth-schema.mjs --applied` asks the library what the applied schema is
-- missing, and that covers tables and columns exactly. It does **not** cover indexes:
-- the library plans an index only for a table it is already creating or a column it is
-- already adding, so an index dropped from a table that otherwise still fits is invisible
-- to it — the check reports "nothing missing" and means it.
--
-- That is the gap this section closes, and it is the one worth closing: every index below
-- is on the read path of a request that happens on every page. A dropped one is not an
-- error anywhere, it is a sequential scan that only shows up as latency once the table is
-- production-sized — which is exactly the failure a schema test exists to catch before
-- it ships.
--
-- Existence by name rather than `must_use_index`, deliberately. The three lookups worth
-- proving *usable* already have their plan asserted in the V004 and V005 sections above,
-- against fixtures those sections build. The rest are here as a complete census of what
-- betterauth-schema.sql lists, so the two files can be read against each other: every
-- `create index` in the snapshot is a line here, and adding one there without one here
-- leaves an index nothing asserts.
--
-- `to_regclass` answers null rather than raising, so a missing index is a named failure
-- instead of an aborted script. Index names are quoted inside the string because the
-- library's are camelCase, which PostgreSQL folds without the quotes.
select pg_temp.must_hold(
  (select to_regclass('ouroboros."session_userId_idx"') is not null),
  'session_userId_idx exists — every session lookup by person is served by it');
select pg_temp.must_hold(
  (select to_regclass('ouroboros."account_userId_idx"') is not null),
  'account_userId_idx exists — listing a person''s linked accounts is served by it');
select pg_temp.must_hold(
  (select to_regclass('ouroboros.verification_identifier_idx') is not null),
  'verification_identifier_idx exists — a token is found by its identifier');
select pg_temp.must_hold(
  (select to_regclass('ouroboros."member_organizationId_idx"') is not null),
  'member_organizationId_idx exists — a workspace''s member list is served by it');
select pg_temp.must_hold(
  (select to_regclass('ouroboros."member_userId_idx"') is not null),
  'member_userId_idx exists — the organizations a person belongs to are served by it');
select pg_temp.must_hold(
  (select to_regclass('ouroboros."invitation_organizationId_idx"') is not null),
  'invitation_organizationId_idx exists — a workspace''s pending invitations are served by it');
select pg_temp.must_hold(
  (select to_regclass('ouroboros.invitation_email_idx') is not null),
  'invitation_email_idx exists — #724 finds an invitation by the address it was sent to');
select pg_temp.must_hold(
  (select to_regclass('ouroboros."session_activeOrganizationId_idx"') is not null),
  'session_activeOrganizationId_idx exists — V005''s own addition, on the tenant pointer');

-- `verification` is the one core table no fixture in this file touches — nothing signs in
-- here, so nothing writes a token — which left its shape asserted nowhere. The drift
-- check does cover these columns, and this is the backstop for the case that check cannot
-- reach: a database nobody has run it against.
select pg_temp.must_hold(
  (select count(*) = 4 from information_schema.columns
   where table_schema = 'ouroboros' and table_name = 'verification'
     and column_name in ('id', 'identifier', 'value', 'expiresAt')),
  'verification keeps BetterAuth''s camelCase column names');

-- ===========================================================================
-- V007 — user_preferences, the font scale (#649)
-- ===========================================================================
--
-- One row per person, holding choices only: a person with no row is at the default, so
-- these fixtures write rows deliberately and the absence case is the API's to synthesize
-- (asserted in ouroboros-rest's preferences integration spec, not here — this file tests
-- rules the *schema* makes).
--
-- The state at this point is what the sections above left: Ken (`6666…`) and Maya
-- (`7777…`) are deleted by the cascade assertions above, so Jorge (`8888…`) carries the
-- happy path and the throwaway (`aaaa…`) is, once again, the row whose deletion a
-- cascade assertion observes.

-- --- the default is the design system's default ------------------------------
insert into ouroboros.user_preferences (user_id)
  values ('88888888-8888-8888-8888-888888888888');

select pg_temp.must_hold(
  (select font_scale = '100' from ouroboros.user_preferences
   where user_id = '88888888-8888-8888-8888-888888888888'),
  'a preferences row written with no font_scale is at 100 — § 4''s default');

-- --- the five steps are the whole vocabulary ---------------------------------
select pg_temp.must_reject(
  $$update ouroboros.user_preferences set font_scale = '90'
    where user_id = '88888888-8888-8888-8888-888888888888'$$,
  'font_scale rejects a step § 4 does not name', 'user_preferences_font_scale');

-- The same number in a spelling the UI never stamps. Text comparison is exact, which is
-- the point of storing a label rather than a numeric: '100.0' is not '100'.
select pg_temp.must_reject(
  $$update ouroboros.user_preferences set font_scale = '100.0'
    where user_id = '88888888-8888-8888-8888-888888888888'$$,
  'font_scale rejects a respelling of a named step', 'user_preferences_font_scale');

-- And every named step is accepted — the CHECK is a vocabulary, not a subset of one.
update ouroboros.user_preferences set font_scale = '87.5'
  where user_id = '88888888-8888-8888-8888-888888888888';
update ouroboros.user_preferences set font_scale = '112.5'
  where user_id = '88888888-8888-8888-8888-888888888888';
update ouroboros.user_preferences set font_scale = '125'
  where user_id = '88888888-8888-8888-8888-888888888888';
update ouroboros.user_preferences set font_scale = '150'
  where user_id = '88888888-8888-8888-8888-888888888888';

select pg_temp.must_hold(
  (select font_scale = '150' from ouroboros.user_preferences
   where user_id = '88888888-8888-8888-8888-888888888888'),
  'every step § 4 names is storable, ending at 150');

-- --- one row per person ------------------------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.user_preferences (user_id, font_scale)
    values ('88888888-8888-8888-8888-888888888888', '125')$$,
  'a second preferences row for the same person is refused', 'user_preferences_pkey');

-- --- a person who does not exist cannot hold preferences ----------------------
select pg_temp.must_reject(
  $$insert into ouroboros.user_preferences (user_id)
    values ('nobody-at-all')$$,
  'user_preferences.user_id must name a real person', 'user_preferences_user_id_fkey');

-- --- deleting the person deletes their choices --------------------------------
insert into ouroboros.user_preferences (user_id, font_scale)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '125');

delete from ouroboros."user" where "id" = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.user_preferences
   where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'deleting a "user" cascades to their preferences');

-- --- updated_at moves on its own -----------------------------------------------
-- The V001 trigger, attached here too: the mirror-reconciliation story reads freshness
-- from this column, so a row whose updated_at never moved would claim a choice made at
-- account creation was made just now.
select pg_temp.must_hold(
  (select tgname = 'user_preferences_touch_updated_at' from pg_trigger
   where tgrelid = 'ouroboros.user_preferences'::regclass and not tgisinternal),
  'user_preferences carries the touch_updated_at trigger');

-- ===========================================================================
-- V008 — runs, the loop lifecycle read-model (#64)
-- ===========================================================================
--
-- The first table of the dashboard read-model, and the one three of mockup 02's six
-- surfaces are views over. Nothing writes it yet — the loop engine is v2 (#54) — so
-- every rule a reader depends on is a database constraint rather than an application
-- invariant, and this section is where those constraints are held to their word.
--
-- Its own fixtures, rather than the ones above. By this point `org-acme` has been
-- deleted by the cascade assertions and `org-globex`'s repositories went with the org
-- that was deleted under it, so there is no organization-with-a-repository pair left to
-- hang a run off. Two fresh workspaces are also what the cross-tenant assertion needs:
-- one to own the run, and one to own a repository the run must not be allowed to name.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-loop',  'Loop Works',   'loop-works',   now()),
  ('org-other', 'Other Works',  'other-works',  now());

insert into ouroboros.github_orgs (id, organization_id, login, enabled) values
  ('e0000000-0000-0000-0000-00000000000a', 'org-loop',  'loop-works',  true),
  ('e0000000-0000-0000-0000-00000000000b', 'org-other', 'other-works', true);

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch) values
  ('efff0000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a',
   'helios-firmware', true, 'main'),
  ('efff0000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000b',
   'other-firmware',  true, 'main');

-- --- an active loop, exactly as the c-8 card renders one ----------------------
-- Mockup 02's first row: `#482 Fix flaky CAN-bus telemetry test`, `standard-fix`,
-- `Implementing · 4/6`, `claude-fable-5`, `coding`. No finish time, no pull request and
-- no checks, because none of those exist while a run is still coding.
insert into ouroboros.runs
    (id, organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
     model, status, stage_label, stage_index, stage_total, started_at)
  values ('e1000000-0000-0000-0000-000000000482', 'org-loop',
          'efff0000-0000-0000-0000-00000000000a', 482,
          'Fix flaky CAN-bus telemetry test', 'standard-fix', 'claude-fable-5',
          'coding', 'Implementing', 4, 6, now() - interval '12 minutes');

select pg_temp.must_hold(
  (select finished_at is null and pr_number is null and checks_total is null
     from ouroboros.runs where id = 'e1000000-0000-0000-0000-000000000482'),
  'an active run is representable with no finish time, pull request or checks');

-- --- the status vocabulary is closed ------------------------------------------
--
-- Acceptance criterion: the status CHECK rejects an unknown value. Everything
-- downstream partitions rows by this column, so a seventh value is a row that appears
-- in neither card — invisible rather than wrong, which is worse.
select pg_temp.must_reject(
  $$update ouroboros.runs set status = 'queued'
    where id = 'e1000000-0000-0000-0000-000000000482'$$,
  'runs.status rejects a value outside the six F2 names', 'runs_status');

-- And all six are storable — the CHECK is a vocabulary, not a subset of one. The three
-- terminal ones are exercised below, where they can carry the finish time they require.
update ouroboros.runs set status = 'building', stage_label = 'Build farm', stage_index = 5
  where id = 'e1000000-0000-0000-0000-000000000482';
update ouroboros.runs set status = 'review', stage_label = 'Self-review', stage_index = 6
  where id = 'e1000000-0000-0000-0000-000000000482';
update ouroboros.runs set status = 'coding', stage_label = 'Implementing', stage_index = 4
  where id = 'e1000000-0000-0000-0000-000000000482';

select pg_temp.must_hold(
  (select status = 'coding' from ouroboros.runs
   where id = 'e1000000-0000-0000-0000-000000000482'),
  'every non-terminal status F2 names is storable');

-- --- terminal rows have finished, active rows have not ------------------------
--
-- Acceptance criterion: terminal-status-requires-finished_at, enforced at the database
-- level. Asserted in both directions, because F2 makes the two facts one fact: the
-- status is what puts a row in the *recently closed* card and `finished_at` is when
-- that happened, so either half without the other is a contradiction.
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total, pr_number)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 900,
            'Merged with no finish time', 'standard-fix', 'claude-fable-5',
            'merged', 'Merged', 6, 6, 900)$$,
  'a terminal run must carry finished_at', 'runs_terminal_finished_at');

select pg_temp.must_reject(
  $$update ouroboros.runs set finished_at = now()
    where id = 'e1000000-0000-0000-0000-000000000482'$$,
  'a non-terminal run must not carry finished_at', 'runs_terminal_finished_at');

-- The other arithmetic the *Cycle* column depends on: a run cannot finish before it
-- started, which would render as a negative cycle time.
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total, started_at, finished_at,
       pr_number, checks_passed, checks_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 901,
            'Finished before it started', 'standard-fix', 'claude-fable-5',
            'merged', 'Merged', 6, 6, now(), now() - interval '1 hour', 901, 1, 1)$$,
  'runs.finished_at cannot precede started_at', 'runs_finished_after_started');

-- --- the move between the two cards is one UPDATE ------------------------------
--
-- Decision F2's whole claim, exercised: the same row leaves *Active loops* and joins
-- *Recently closed* by changing its status, with no second table and nothing to sync.
update ouroboros.runs
   set status = 'merged', stage_label = 'Merged', stage_index = 6,
       finished_at = now(), pr_number = 512, checks_passed = 14, checks_total = 14
 where id = 'e1000000-0000-0000-0000-000000000482';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.runs
   where organization_id = 'org-loop' and status in ('coding', 'building', 'review')),
  'a run that reaches a terminal status leaves the active-loops query');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.runs
   where organization_id = 'org-loop' and finished_at is not null),
  'and joins the completions query, with no second table involved');

-- --- the stage meter is renderable ---------------------------------------------
--
-- `stage_index / stage_total` is a bar width. A total of zero divides by zero and an
-- index above the total draws a bar wider than its track.
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 902, 'No stages at all',
            'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 0, 0)$$,
  'runs.stage_total must be at least one', 'runs_stage_total_positive');

select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 903, 'Past the end',
            'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 7, 6)$$,
  'runs.stage_index cannot exceed stage_total', 'runs_stage_index_in_range');

select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 904, 'No stage label',
            'standard-fix', 'claude-fable-5', 'coding', '   ', 1, 6)$$,
  'runs.stage_label must say something — it captions the meter', 'runs_stage_label_present');

-- Zero is deliberately legal: a run that has started but not entered its first stage.
insert into ouroboros.runs
    (id, organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
     model, status, stage_label, stage_index, stage_total)
  values ('e1000000-0000-0000-0000-000000000479', 'org-loop',
          'efff0000-0000-0000-0000-00000000000a', 479,
          'Add OTA rollback on failed checksum', 'feature-loop', 'claude-sonnet-5',
          'coding', 'Starting', 0, 7);
select pg_temp.must_hold(
  (select stage_index = 0 from ouroboros.runs
   where id = 'e1000000-0000-0000-0000-000000000479'),
  'a run that has not entered its first stage is representable as 0/7');

-- --- decision F8: the opaque strings are opaque, not unchecked -----------------
--
-- No vocabulary: the model registry is mockup 06/21's and workflow entities are mockup
-- 04's, so anything the engine recorded must store — including an identifier nobody has
-- seen before, which is the case a CHECK enumerating today's models would break.
insert into ouroboros.runs
    (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
     model, status, stage_label, stage_index, stage_total)
  values
  ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 910, 'Opaque model A',
   'standard-fix', 'ollama/qwen3-coder',     'coding', 'Implementing', 1, 6),
  ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 911, 'Opaque model B',
   'deps-refresh', 'copilot/gpt-5-codex',    'coding', 'Implementing', 1, 6),
  ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 912, 'Opaque model C',
   'nobody-has-filed-this-workflow-yet', 'some-vendor/model-nobody-has-shipped:v9',
   'coding', 'Implementing', 1, 6);
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.runs where issue_number between 910 and 912),
  'runs.model and runs.workflow_tag take any identifier — decision F8, no catalog here');

-- Bounded and non-blank all the same: opaque is not the same as unchecked, and a table
-- cell is not a place for whitespace or a megabyte.
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 913, 'Blank model',
            'standard-fix', '  ', 'coding', 'Implementing', 1, 6)$$,
  'runs.model must not be blank', 'runs_model_present');
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 914, 'Blank tag',
            '', 'claude-fable-5', 'coding', 'Implementing', 1, 6)$$,
  'runs.workflow_tag must not be blank', 'runs_workflow_tag_present');
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 915, ' ',
            'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 1, 6)$$,
  'runs.issue_title must not be blank', 'runs_issue_title_present');
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 916, 'Runaway model',
            'standard-fix', repeat('m', 201), 'coding', 'Implementing', 1, 6)$$,
  'runs.model is bounded', 'runs_model_present');

-- --- the numbers GitHub gave us -------------------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 0, 'There is no issue 0',
            'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 1, 6)$$,
  'runs.issue_number is a positive counter', 'runs_issue_number_positive');

select pg_temp.must_reject(
  $$update ouroboros.runs set pr_number = 0
    where id = 'e1000000-0000-0000-0000-000000000479'$$,
  'runs.pr_number is a positive counter', 'runs_pr_number_positive');

-- --- checks are a pair, or neither ------------------------------------------------
--
-- `14/14` needs both halves; a numerator with no denominator has nothing to divide by,
-- and a passed count above the total is not a fraction the *Checks* column can render.
select pg_temp.must_reject(
  $$update ouroboros.runs set checks_passed = 14
    where id = 'e1000000-0000-0000-0000-000000000479'$$,
  'runs.checks_passed without checks_total is refused', 'runs_checks_paired');
select pg_temp.must_reject(
  $$update ouroboros.runs set checks_passed = 15, checks_total = 14
    where id = 'e1000000-0000-0000-0000-000000000479'$$,
  'more checks passed than exist is refused', 'runs_checks_in_range');

-- Zero of zero is legal and distinct from both-null: a repository with no checks
-- configured is a fact, and not knowing yet is a different one.
update ouroboros.runs set checks_passed = 0, checks_total = 0
  where id = 'e1000000-0000-0000-0000-000000000479';
select pg_temp.must_hold(
  (select checks_total = 0 from ouroboros.runs
   where id = 'e1000000-0000-0000-0000-000000000479'),
  'a run with no checks configured is 0/0, not null');

-- --- a merged run has a pull request ------------------------------------------------
--
-- The *Issue → PR* column reads `#474 → PR #512` from two columns; a merged row with no
-- `pr_number` has no second half to render. The other two terminal statuses are
-- deliberately free of this — a run can fail, or stop for a human, before opening one.
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total, finished_at)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 917, 'Merged into what?',
            'standard-fix', 'claude-fable-5', 'merged', 'Merged', 6, 6, now())$$,
  'a merged run must name the pull request it merged', 'runs_merged_has_pr');

insert into ouroboros.runs
    (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
     model, status, stage_label, stage_index, stage_total, finished_at)
  values
  ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 918, 'Stopped for a person',
   'standard-fix', 'claude-sonnet-5', 'needs_human', 'Self-review', 6, 6, now()),
  ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 919, 'Never got that far',
   'standard-fix', 'claude-sonnet-5', 'failed', 'Build farm', 3, 6, now());
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.runs where issue_number in (918, 919)),
  'needs_human and failed close without a pull request, as a stalled run does');

-- --- the same issue may be run more than once -----------------------------------
--
-- Deliberately no unique key on (organization_id, issue_number): a run that failed and
-- was retried is two runs, and the completions card is a history rather than a set.
-- (F.2's `queue_items`, #65, is where an issue appears at most once.)
insert into ouroboros.runs
    (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
     model, status, stage_label, stage_index, stage_total)
  values ('org-loop', 'efff0000-0000-0000-0000-00000000000a', 919, 'Never got that far',
          'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 1, 6);
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.runs
   where organization_id = 'org-loop' and issue_number = 919),
  'an issue that was retried has two runs — the table is a history, not a set');

-- --- both parents must exist, and must agree ----------------------------------------
--
-- The workspace is refused by the *trigger* rather than by its foreign key, and that is
-- not an accident of ordering worth working around: a BEFORE trigger runs ahead of the
-- foreign key's AFTER check, and every organization the trigger will accept is one that
-- exists — it reads the owning organization out of `github_orgs` and demands equality.
-- So for any row naming a real repository, "the organization exists" is implied by "the
-- two parents agree", and the stricter rule is the one that fires. The foreign key is
-- still what carries the cascade, and its existence and its `on delete cascade` are
-- asserted from the catalogue below, with the cascade itself exercised at the foot of
-- this section.
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('no-such-org', 'efff0000-0000-0000-0000-00000000000a', 920, 'Orphan run',
            'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 1, 6)$$,
  'a run naming an organization that does not exist is refused',
  'runs_repo_in_organization');

select pg_temp.must_hold(
  (select count(*) = 2 from pg_constraint
    where conrelid = 'ouroboros.runs'::regclass and contype = 'f'
      and confdeltype = 'c'
      and conname in ('runs_organization_id_fkey', 'runs_github_repo_id_fkey')),
  'both of runs'' foreign keys exist and cascade on delete');

select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-0000000000ff', 921, 'Orphan run',
            'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 1, 6)$$,
  'runs.github_repo_id references an existing repository', 'runs_github_repo_id_fkey');

-- The rule two foreign keys cannot express, and the one that matters most: a run scoped
-- to one workspace must not target another workspace's repository. Getting this wrong is
-- not a broken join — it is one tenant's issue titles rendering on another's dashboard.
select pg_temp.must_reject(
  $$insert into ouroboros.runs
      (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
       model, status, stage_label, stage_index, stage_total)
    values ('org-loop', 'efff0000-0000-0000-0000-00000000000b', 922, 'Somebody else''s repo',
            'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 1, 6)$$,
  'a run cannot target a repository belonging to another organization',
  'runs_repo_in_organization');

-- And the same rule on the way through: a run cannot be *moved* onto another
-- workspace's repository either, which is why the trigger fires on UPDATE as well.
select pg_temp.must_reject(
  $$update ouroboros.runs set github_repo_id = 'efff0000-0000-0000-0000-00000000000b'
    where id = 'e1000000-0000-0000-0000-000000000479'$$,
  'a run cannot be updated onto another organization''s repository',
  'runs_repo_in_organization');

-- --- the indexes the two cards need -------------------------------------------------
--
-- Acceptance criterion: `EXPLAIN` shows index use for the active-loops query and for the
-- seven-day completions window. Sequential scans are off for the same reason as every
-- other plan assertion in this file — a handful of fixture rows is genuinely cheaper to
-- scan, and what is being asserted is that a usable index exists at production size.
set local enable_seqscan = off;

select pg_temp.must_use_index(
  $$select issue_number, stage_index, stage_total from ouroboros.runs
     where organization_id = 'org-loop'
       and status in ('coding', 'building', 'review')$$,
  'runs_organization_status_idx');

select pg_temp.must_use_index(
  $$select issue_number, pr_number from ouroboros.runs
     where organization_id = 'org-loop'
       and finished_at >= now() - interval '7 days'
     order by finished_at desc$$,
  'runs_organization_finished_at_idx');

-- Not a read path: `github_repos` cascades into this table, and an unindexed referencing
-- column makes every repository deletion a full scan of the runs history.
select pg_temp.must_use_index(
  $$select id from ouroboros.runs
     where github_repo_id = 'efff0000-0000-0000-0000-00000000000a'$$,
  'runs_github_repo_id_idx');

set local enable_seqscan = on;

-- --- updated_at moves on its own -------------------------------------------------
-- Once the engine writes this table, "when was this run last heard from" is what
-- separates a loop that is working from one that stopped without saying so.
update ouroboros.runs set updated_at = '2000-01-01T00:00:00Z'
  where id = 'e1000000-0000-0000-0000-000000000479';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.runs
   where id = 'e1000000-0000-0000-0000-000000000479'),
  'runs.updated_at is stamped from the server clock by its touch trigger');

-- --- the cascades, in both directions ------------------------------------------------
--
-- Deleting a repository takes its runs with it: a run whose *Issue* column links into a
-- repository nobody can reach is not history, it is a broken row.
delete from ouroboros.github_repos where id = 'efff0000-0000-0000-0000-00000000000a';
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.runs
   where github_repo_id = 'efff0000-0000-0000-0000-00000000000a'),
  'deleting a github_repo cascades to the runs that targeted it');

-- And the workspace cascade, end to end — organization → github_orgs → github_repos →
-- runs, one statement and every hop.
insert into ouroboros.runs
    (organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
     model, status, stage_label, stage_index, stage_total)
  values ('org-other', 'efff0000-0000-0000-0000-00000000000b', 930, 'Doomed with its org',
          'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 1, 6);

delete from ouroboros.organization where "id" = 'org-other';
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.runs where organization_id = 'org-other'),
  'deleting an organization cascades through its orgs and repos to their runs');

-- ===========================================================================
-- V009 — queue_items, the ordered per-organization issue queue (#65)
-- ===========================================================================
--
-- The second table of the dashboard read-model, behind *Up next in queue* and the
-- *Queued issues* stat. Nothing writes it yet either — reorder and remove are the
-- issues screen's (#73) — so, as with `runs`, every rule a reader depends on is a
-- constraint rather than an application invariant, and this section holds them to it.
--
-- Its own fixtures again: the V008 section deleted `org-other` and both of the
-- repositories it used, so there is no organization-with-a-repository pair left. Two
-- fresh workspaces, for the same reason as before — one to own the queue, one to own a
-- repository the queue must not be allowed to name.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-queue', 'Queue Works', 'queue-works', now()),
  ('org-rival', 'Rival Works', 'rival-works', now());

insert into ouroboros.github_orgs (id, organization_id, login, enabled) values
  ('e0000000-0000-0000-0000-00000000000c', 'org-queue', 'queue-works', true),
  ('e0000000-0000-0000-0000-00000000000d', 'org-rival', 'rival-works', true);

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch) values
  ('efff0000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000c',
   'helios-firmware', true, 'main'),
  ('efff0000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000d',
   'rival-firmware',  true, 'main');

-- --- the card, exactly as mockup 02 draws it ----------------------------------
--
-- The five rows of `c-5` in their order, with the five chips the mockup renders — one
-- each, which is what makes this fixture also the proof that the effort vocabulary is
-- the mockup's. The estimates sum to 580 minutes, the `est. 9h 40m of autonomous work`
-- the stat's subline reads.
insert into ouroboros.queue_items
    (id, organization_id, github_repo_id, issue_number, issue_title, effort,
     workflow_tag, position, est_minutes)
  values
  ('e2000000-0000-0000-0000-000000000485', 'org-queue',
   'efff0000-0000-0000-0000-00000000000c', 485, 'Watchdog reset on I²C bus lockup',
   'm',  'standard-fix', 1,  90),
  ('e2000000-0000-0000-0000-000000000486', 'org-queue',
   'efff0000-0000-0000-0000-00000000000c', 486, 'Expose battery health over BLE GATT',
   'l',  'feature-loop', 2, 180),
  ('e2000000-0000-0000-0000-000000000488', 'org-queue',
   'efff0000-0000-0000-0000-00000000000c', 488, 'Typo sweep in operator manual',
   'xs', 'docs-loop',    3,  15),
  ('e2000000-0000-0000-0000-000000000490', 'org-queue',
   'efff0000-0000-0000-0000-00000000000c', 490, 'Migrate build to Zephyr 4.2',
   'xl', 'deps-refresh', 4, 240),
  ('e2000000-0000-0000-0000-000000000491', 'org-queue',
   'efff0000-0000-0000-0000-00000000000c', 491, 'Add CRC to config persistence layer',
   's',  'standard-fix', 5,  55);

select pg_temp.must_hold(
  (select array_agg(issue_number order by position) = array[485, 486, 488, 490, 491]
     from ouroboros.queue_items where organization_id = 'org-queue'),
  'the queue reads back in position order — the c-5 card''s query');

select pg_temp.must_hold(
  (select sum(est_minutes) = 580 from ouroboros.queue_items
   where organization_id = 'org-queue'),
  'the Queued issues stat is sum(est_minutes) — 580 minutes, "est. 9h 40m"');

-- --- the five chips, and nothing else -------------------------------------------
--
-- Acceptance criterion: the effort CHECK matches the mockup's five chips exactly. All
-- five are already stored above, one per row; what is left is that a sixth is refused.
select pg_temp.must_hold(
  (select count(distinct effort) = 5 from ouroboros.queue_items
   where organization_id = 'org-queue'),
  'all five of decision F9''s effort chips are storable');

select pg_temp.must_reject(
  $$update ouroboros.queue_items set effort = 'xxl'
    where id = 'e2000000-0000-0000-0000-000000000485'$$,
  'queue_items.effort rejects a sixth size', 'queue_items_effort');

-- Lower-case is the stored form — it is a class name, not a caption, and the card
-- upper-cases it. An upper-case chip would be a value no `where effort = 'm'` finds.
select pg_temp.must_reject(
  $$update ouroboros.queue_items set effort = 'M'
    where id = 'e2000000-0000-0000-0000-000000000485'$$,
  'queue_items.effort is stored lower-case', 'queue_items_effort');

-- --- an issue queues once ---------------------------------------------------------
--
-- Acceptance criterion: `(organization_id, issue_number)` uniqueness rejects a duplicate
-- enqueue. Immediately, at the statement — see the migration for why this key does not
-- defer and the position key does.
select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('org-queue', 'efff0000-0000-0000-0000-00000000000c', 485,
            'Watchdog reset on I²C bus lockup', 'm', 'standard-fix', 6)$$,
  'the same issue cannot be queued twice in one workspace',
  'queue_items_organization_issue_key');

-- Scoped to the workspace, though: another organization numbering an issue `485` is
-- numbering a different issue, and its queue is a different queue.
insert into ouroboros.queue_items
    (organization_id, github_repo_id, issue_number, issue_title, effort,
     workflow_tag, position)
  values ('org-rival', 'efff0000-0000-0000-0000-00000000000d', 485,
          'A different #485 entirely', 'm', 'standard-fix', 1);
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.queue_items where issue_number = 485),
  'two workspaces may each queue their own issue #485');

-- And so is the position key: both workspaces have an item at position 1.
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.queue_items where position = 1),
  'position uniqueness is per workspace, not global');

-- --- reordering ---------------------------------------------------------------------
--
-- Acceptance criterion: position uniqueness per organization is enforced, *and* a
-- position swap inside a transaction succeeds. The constraint is deferred, so the swap
-- is plain SQL: the intermediate state where two rows share a position exists only
-- inside the transaction, which is where an ordering is allowed to be momentarily
-- invalid.
--
-- Two statements first — the form a reorder actually takes, one row moved at a time.
update ouroboros.queue_items set position = 2
  where id = 'e2000000-0000-0000-0000-000000000485';
update ouroboros.queue_items set position = 1
  where id = 'e2000000-0000-0000-0000-000000000486';
select pg_temp.must_hold(
  (select array_agg(issue_number order by position) = array[486, 485, 488, 490, 491]
     from ouroboros.queue_items where organization_id = 'org-queue'),
  'a two-statement position swap succeeds inside a transaction');

-- And the single-statement form, which an immediate constraint would also refuse —
-- PostgreSQL checks a unique index as each row version is written, not at the end of the
-- statement. Swaps them back.
update ouroboros.queue_items
   set position = case id when 'e2000000-0000-0000-0000-000000000485' then 1
                          when 'e2000000-0000-0000-0000-000000000486' then 2 end
 where id in ('e2000000-0000-0000-0000-000000000485',
              'e2000000-0000-0000-0000-000000000486');
select pg_temp.must_hold(
  (select array_agg(issue_number order by position) = array[485, 486, 488, 490, 491]
     from ouroboros.queue_items where organization_id = 'org-queue'),
  'a one-statement position swap succeeds too');

-- Deferred is not unenforced. `set constraints … immediate` is the check happening early
-- — at commit it happens on its own — and a duplicate position does not survive it.
-- Both statements are one string so the rejection is caught in the savepoint the helper
-- opens; the constraint's deferred mode is restored with it.
select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('org-queue', 'efff0000-0000-0000-0000-00000000000c', 492,
            'Two issues in one place', 'm', 'standard-fix', 1);
    set constraints ouroboros.queue_items_organization_position_key immediate$$,
  'two queue items cannot share a position in one workspace',
  'queue_items_organization_position_key');

-- The deferral is the property the swap depends on, so it is asserted from the
-- catalogue rather than inferred from the swap having worked: deferrable, and deferred
-- by default, which is what makes a reorder plain SQL with no `set constraints` in it.
select pg_temp.must_hold(
  (select condeferrable and condeferred from pg_constraint
   where conrelid = 'ouroboros.queue_items'::regclass
     and conname = 'queue_items_organization_position_key'),
  'the position key is deferrable and initially deferred');

-- The natural key is the opposite, deliberately: a duplicate enqueue is a thing a person
-- can ask for and must be told about where it happened, not at commit.
select pg_temp.must_hold(
  (select not condeferrable from pg_constraint
   where conrelid = 'ouroboros.queue_items'::regclass
     and conname = 'queue_items_organization_issue_key'),
  'the natural key is immediate, so a duplicate enqueue fails at the statement');

-- --- the numbers ---------------------------------------------------------------------
--
-- The head of the queue is *next*, not zeroth, and there is no issue `#0`.
select pg_temp.must_reject(
  $$update ouroboros.queue_items set position = 0
    where id = 'e2000000-0000-0000-0000-000000000485'$$,
  'queue_items.position starts at 1', 'queue_items_position_positive');

select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('org-queue', 'efff0000-0000-0000-0000-00000000000c', 0,
            'There is no issue 0', 'm', 'standard-fix', 6)$$,
  'queue_items.issue_number is a positive counter',
  'queue_items_issue_number_positive');

-- --- an estimate is absent or real ------------------------------------------------
--
-- Null means *not estimated*, and it is not zero: an unestimated item is an ordinary
-- queue row that contributes nothing to the stat, while zero would claim the loop needs
-- no time at all. `sum` skips the nulls without being asked, which is why the stat needs
-- no coalesce.
insert into ouroboros.queue_items
    (id, organization_id, github_repo_id, issue_number, issue_title, effort,
     workflow_tag, position, est_minutes)
  values ('e2000000-0000-0000-0000-000000000493', 'org-queue',
          'efff0000-0000-0000-0000-00000000000c', 493, 'Nobody has sized this yet',
          'm', 'standard-fix', 6, null);
select pg_temp.must_hold(
  (select count(*) = 6 and sum(est_minutes) = 580 from ouroboros.queue_items
   where organization_id = 'org-queue'),
  'an unestimated item queues and adds nothing to the estimate');

select pg_temp.must_reject(
  $$update ouroboros.queue_items set est_minutes = 0
    where id = 'e2000000-0000-0000-0000-000000000493'$$,
  'queue_items.est_minutes rejects zero — null is how "not estimated" is said',
  'queue_items_est_minutes_sane');

select pg_temp.must_reject(
  $$update ouroboros.queue_items set est_minutes = 20161
    where id = 'e2000000-0000-0000-0000-000000000493'$$,
  'queue_items.est_minutes is bounded, so a units mistake cannot add a century',
  'queue_items_est_minutes_sane');

-- --- decision F8: the tag is opaque, not unchecked ----------------------------------
--
-- Workflow entities are mockup 04's, so a tag naming a workflow nobody has filed must
-- store — and a blank or runaway one must not.
insert into ouroboros.queue_items
    (organization_id, github_repo_id, issue_number, issue_title, effort,
     workflow_tag, position)
  values ('org-queue', 'efff0000-0000-0000-0000-00000000000c', 494,
          'Queued under a workflow nobody has filed', 'l',
          'nobody-has-filed-this-workflow-yet', 7);
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.queue_items where issue_number = 494),
  'queue_items.workflow_tag takes any tag — decision F8, no catalog here');

select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('org-queue', 'efff0000-0000-0000-0000-00000000000c', 495,
            'Blank tag', 'm', '   ', 8)$$,
  'queue_items.workflow_tag must not be blank', 'queue_items_workflow_tag_present');

select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('org-queue', 'efff0000-0000-0000-0000-00000000000c', 496,
            'Runaway tag', 'm', repeat('t', 65), 8)$$,
  'queue_items.workflow_tag is bounded', 'queue_items_workflow_tag_present');

select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('org-queue', 'efff0000-0000-0000-0000-00000000000c', 497,
            ' ', 'm', 'standard-fix', 8)$$,
  'queue_items.issue_title must not be blank', 'queue_items_issue_title_present');

-- --- both parents must exist, and must agree ------------------------------------------
--
-- The rule V008 wrote for `runs`, now shared with this table — and the reason the
-- migration re-pointed the runs trigger rather than copying the function. A queue item
-- naming one workspace and another's repository is not a broken join: it is one
-- tenant's issue titles rendering on another's dashboard, in the card that says what
-- the loop will do next.
--
-- As on `runs`, the trigger fires ahead of the organization foreign key's own check and
-- subsumes it — every organization it accepts is one that exists — so a row naming no
-- organization at all is refused under the trigger's name too.
select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('no-such-org', 'efff0000-0000-0000-0000-00000000000c', 498,
            'Orphan item', 'm', 'standard-fix', 8)$$,
  'a queue item naming an organization that does not exist is refused',
  'queue_items_repo_in_organization');

select pg_temp.must_hold(
  (select count(*) = 2 from pg_constraint
    where conrelid = 'ouroboros.queue_items'::regclass and contype = 'f'
      and confdeltype = 'c'
      and conname in ('queue_items_organization_id_fkey',
                      'queue_items_github_repo_id_fkey')),
  'both of queue_items'' foreign keys exist and cascade on delete');

select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('org-queue', 'efff0000-0000-0000-0000-0000000000ff', 499,
            'Orphan item', 'm', 'standard-fix', 8)$$,
  'queue_items.github_repo_id references an existing repository',
  'queue_items_github_repo_id_fkey');

select pg_temp.must_reject(
  $$insert into ouroboros.queue_items
      (organization_id, github_repo_id, issue_number, issue_title, effort,
       workflow_tag, position)
    values ('org-queue', 'efff0000-0000-0000-0000-00000000000d', 500,
            'Somebody else''s repo', 'm', 'standard-fix', 8)$$,
  'a queue item cannot target a repository belonging to another organization',
  'queue_items_repo_in_organization');

select pg_temp.must_reject(
  $$update ouroboros.queue_items
       set github_repo_id = 'efff0000-0000-0000-0000-00000000000d'
     where id = 'e2000000-0000-0000-0000-000000000485'$$,
  'a queue item cannot be updated onto another organization''s repository',
  'queue_items_repo_in_organization');

-- --- one copy of that rule, for both tables --------------------------------------------
--
-- V009 generalised V008's function rather than writing a second one, and re-pointed the
-- runs trigger at it — which is why the runs assertions above still report
-- `runs_repo_in_organization`: the name callers see is the trigger's, and the trigger
-- kept its name. Both halves are asserted, because a copy left behind would drift.
select pg_temp.must_hold(
  (select count(*) = 2 from pg_trigger
    where tgfoid = 'ouroboros.repo_in_organization()'::regprocedure
      and tgrelid in ('ouroboros.runs'::regclass,
                      'ouroboros.queue_items'::regclass)),
  'runs and queue_items share one repo-in-organization function');

select pg_temp.must_hold(
  (select count(*) = 0 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ouroboros' and p.proname = 'runs_repo_in_organization'),
  'and the per-table copy V008 created is gone');

-- --- the indexes the card needs ----------------------------------------------------
--
-- The queue's two reads are both served by the position key's index — the ordered head
-- of the queue, and the stat that aggregates the same range — so what is asserted here
-- is that they are index range scans, and that nothing else was created to do the same
-- job.
--
-- Sequential scans are off for the reason every plan assertion in this file turns them
-- off: a handful of fixture rows is genuinely cheaper to scan, and the claim under test
-- is that a usable index exists at production size. Sorting is off as well for the first
-- one, and that is the sharper half of the claim: with a sort available the planner will
-- happily read the rows through *either* unique key and order them afterwards, which
-- proves nothing about the ordering. Refused the sort, it has to find an index that
-- already delivers `position` in order — and the plan is an index scan on the position
-- key with no sort node above it, which is what makes the card's `order by position
-- limit 5` a range read rather than a read of the whole queue.
set local enable_seqscan = off;
set local enable_sort    = off;

select pg_temp.must_use_index(
  $$select issue_number, effort, workflow_tag from ouroboros.queue_items
     where organization_id = 'org-queue'
     order by position limit 5$$,
  'queue_items_organization_position_key');

set local enable_sort = on;

-- The stat asks only for the workspace's range, in no order, so *either* unique key
-- answers it identically — both lead with `organization_id` — and which one the planner
-- picks is its business. Naming one would be asserting a coin toss; what matters, and
-- what is asserted, is that the aggregate is an index range scan rather than a read of
-- every workspace's queue.
select pg_temp.must_use_index(
  $$select count(*), sum(est_minutes) from ouroboros.queue_items
     where organization_id = 'org-queue'$$,
  'Index Scan on queue_items_organization');

-- Not a read path: the cascade's. `github_repos` cascades into this table, and an
-- unindexed referencing column makes every repository deletion a full scan of the queue.
select pg_temp.must_use_index(
  $$select id from ouroboros.queue_items
     where github_repo_id = 'efff0000-0000-0000-0000-00000000000c'$$,
  'queue_items_github_repo_id_idx');

set local enable_seqscan = on;

-- The unique constraint's index *is* the card's index, so a second one over the same
-- leading columns would be the same b-tree maintained twice on every reorder.
select pg_temp.must_hold(
  (select count(*) = 1 from pg_indexes
    where schemaname = 'ouroboros' and tablename = 'queue_items'
      and indexdef like '%(organization_id, "position")%'),
  'exactly one index leads with (organization_id, position)');

-- --- updated_at moves on its own ------------------------------------------------------
-- On a queue this column answers "when was this row last reordered or re-estimated",
-- which is the question a queue that looks stale is asked.
update ouroboros.queue_items set updated_at = '2000-01-01T00:00:00Z'
  where id = 'e2000000-0000-0000-0000-000000000485';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.queue_items
   where id = 'e2000000-0000-0000-0000-000000000485'),
  'queue_items.updated_at is stamped from the server clock by its touch trigger');

-- And `enqueued_at` does not move with it: it is the queue's fact rather than the row's,
-- so a reorder or a re-estimate must not make an item look freshly queued. Back-dated
-- explicitly first, because every default in this file is the same transaction's `now()`
-- — an item queued and updated in one transaction cannot tell the two columns apart, and
-- an assertion that cannot fail is not one.
update ouroboros.queue_items set enqueued_at = now() - interval '3 days'
  where id = 'e2000000-0000-0000-0000-000000000485';
update ouroboros.queue_items set est_minutes = 95
  where id = 'e2000000-0000-0000-0000-000000000485';
select pg_temp.must_hold(
  (select enqueued_at = now() - interval '3 days' and updated_at = now()
     from ouroboros.queue_items
    where id = 'e2000000-0000-0000-0000-000000000485'),
  'queue_items.enqueued_at is left alone by an update that touches updated_at');

-- --- the cascades, in both directions --------------------------------------------------
--
-- Deleting a repository takes its queued issues with it: an item whose row links into a
-- repository nobody can reach is not a plan, it is a broken row.
delete from ouroboros.github_repos where id = 'efff0000-0000-0000-0000-00000000000d';
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.queue_items
   where github_repo_id = 'efff0000-0000-0000-0000-00000000000d'),
  'deleting a github_repo cascades to the queue items that named it');

-- And the workspace cascade, end to end — organization → github_orgs → github_repos →
-- queue_items, one statement and every hop.
delete from ouroboros.organization where "id" = 'org-queue';
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.queue_items where organization_id = 'org-queue'),
  'deleting an organization cascades through its orgs and repos to its queue');

-- ===========================================================================
-- V010 — token_usage and token_usage_daily, the spend ledger (#66)
-- ===========================================================================
--
-- The third table of the dashboard read-model, behind the *Token spend · today* stat —
-- `4.2M` over `≈ $18.60 across 4 providers`. Nothing writes it yet either (the engine is
-- v2, #54; the seeds are #68 and the endpoint is #70), so the same rule as the two
-- sections above applies: everything a reader depends on is a constraint here rather
-- than an application invariant.
--
-- Fresh fixtures once more. `org-queue` was deleted by the cascade assertions above and
-- `org-rival` kept its GitHub org but lost its repository, so there is again no
-- organization-with-a-repository pair to hang a run off — and two workspaces are what
-- the cross-tenant assertion needs, one to own the spend and one to own a run the spend
-- must not be allowed to name.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-spend', 'Spend Works', 'spend-works', now()),
  ('org-drift', 'Drift Works', 'drift-works', now());

insert into ouroboros.github_orgs (id, organization_id, login, enabled) values
  ('e0000000-0000-0000-0000-00000000000e', 'org-spend', 'spend-works', true),
  ('e0000000-0000-0000-0000-00000000000f', 'org-drift', 'drift-works', true);

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch) values
  ('efff0000-0000-0000-0000-00000000000e', 'e0000000-0000-0000-0000-00000000000e',
   'helios-firmware', true, 'main'),
  ('efff0000-0000-0000-0000-00000000000f', 'e0000000-0000-0000-0000-00000000000f',
   'drift-firmware',  true, 'main');

insert into ouroboros.runs
    (id, organization_id, github_repo_id, issue_number, issue_title, workflow_tag,
     model, status, stage_label, stage_index, stage_total)
  values
  ('e3000000-0000-0000-0000-000000000482', 'org-spend',
   'efff0000-0000-0000-0000-00000000000e', 482, 'Fix flaky CAN-bus telemetry test',
   'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 4, 6),
  ('e3000000-0000-0000-0000-000000000499', 'org-drift',
   'efff0000-0000-0000-0000-00000000000f', 499, 'Somebody else''s work',
   'standard-fix', 'claude-fable-5', 'coding', 'Implementing', 1, 6);

-- --- the stat card, exactly as mockup 02 renders it ---------------------------------
--
-- Acceptance criterion: the view returns per-day, per-organization, per-provider sums
-- matching the events inserted underneath. The fixture is the card itself — a day of
-- spend across the four providers mockup 07 lists, adding up to the `4.2M` and the
-- `≈ $18.60` the stat shows.
--
-- Two of the rows are the same provider, which is what makes this a test of the rollup
-- rather than a re-reading of the rows: `anthropic` appears twice and must come back
-- once, summed. One is attributed to a run and the rest are not, because both are
-- ordinary.
--
-- And `ollama` is unpriced — null, not zero. Local inference has no invoice to price it
-- from until #92 says otherwise, and the day's cost is therefore the cost of what *is*
-- priced. That is the `≈` in the mockup's own subline, and it is asserted below rather
-- than assumed.
insert into ouroboros.token_usage
    (id, organization_id, run_id, provider, model, tokens_in, tokens_out, cost_cents)
  values
  ('e4000000-0000-0000-0000-00000000000a', 'org-spend',
   'e3000000-0000-0000-0000-000000000482', 'anthropic', 'claude-fable-5',
   1200000, 300000, 1100.0000),
  ('e4000000-0000-0000-0000-00000000000b', 'org-spend',
   'e3000000-0000-0000-0000-000000000482', 'anthropic', 'claude-sonnet-5',
   400000, 100000, 320.0000),
  ('e4000000-0000-0000-0000-00000000000c', 'org-spend', null,
   'openai', 'gpt-5-codex', 700000, 200000, 380.0000),
  ('e4000000-0000-0000-0000-00000000000d', 'org-spend', null,
   'copilot', 'copilot/gpt-5-codex', 600000, 100000, 60.0000),
  ('e4000000-0000-0000-0000-00000000000e', 'org-spend', null,
   'ollama', 'ollama/qwen3-coder', 480000, 120000, null);

-- One row per provider, not one per event: five events, four rows, and `anthropic`'s two
-- calls summed into one.
select pg_temp.must_hold(
  (select count(*) = 4 from ouroboros.token_usage_daily
    where organization_id = 'org-spend'),
  'token_usage_daily rolls five events up into one row per provider');

select pg_temp.must_hold(
  (select events = 2 and tokens_in = 1600000 and tokens_out = 400000
      and tokens_total = 2000000 and cost_cents = 1420.0000
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend' and provider = 'anthropic'),
  'the provider''s two calls are summed into one row, in every column');

-- The card's whole read, in the form #70 will write it — and the three numbers the
-- mockup draws.
select pg_temp.must_hold(
  (select sum(tokens_total) = 4200000 and sum(cost_cents) = 1860.0000
      and count(*) = 4
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend'
      and day = (now() at time zone 'utc')::date),
  'the stat card reads 4.2M tokens and $18.60 across 4 providers from the view');

-- --- a day is a day, and it is UTC --------------------------------------------------
--
-- The rollup's grouping key, exercised: an event two days old is the same organization
-- and the same provider, and it must not join today's row. Backdated explicitly, because
-- every default in this file is the same transaction's `now()`.
insert into ouroboros.token_usage
    (id, organization_id, provider, model, tokens_in, tokens_out, cost_cents,
     occurred_at)
  values ('e4000000-0000-0000-0000-00000000000f', 'org-spend', 'anthropic',
          'claude-fable-5', 90000, 10000, 44.0000, now() - interval '2 days');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.token_usage_daily
    where organization_id = 'org-spend' and provider = 'anthropic'),
  'the same provider on two days is two rows, not one');

select pg_temp.must_hold(
  (select sum(tokens_total) = 4200000 and sum(cost_cents) = 1860.0000
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend'
      and day = (now() at time zone 'utc')::date),
  'and the older day is not counted in today''s card');

select pg_temp.must_hold(
  (select day = (now() at time zone 'utc')::date - 2
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend' and provider = 'anthropic'
      and tokens_total = 100000),
  'the backdated event lands on its own UTC day');

-- The day is UTC rather than the session's, which is the whole reason the view spells the
-- conversion out instead of writing `date_trunc('day', occurred_at)`. That form resolves
-- in the *session's* time zone, so the same ledger would answer the API server and a psql
-- session differently — a rollup nobody can reconcile.
--
-- Two fixed instants half an hour either side of a UTC midnight, which is what makes this
-- deterministic rather than a test that only fails when it happens to be run in the right
-- hour: at 23:30Z a session east of UTC has already turned the page, and at 00:30Z a
-- session west of it has not. Fixed rather than relative for the same reason — an instant
-- computed from `now()` carries whatever time of day the suite was run at. The date is
-- historical so that no relative day above can ever collide with it.
insert into ouroboros.token_usage
    (id, organization_id, provider, model, tokens_in, tokens_out, occurred_at)
  values
  ('e4000000-0000-0000-0000-000000002330', 'org-spend', 'anthropic', 'claude-fable-5',
   2330, 0, timestamptz '2001-09-09 23:30:00+00'),
  ('e4000000-0000-0000-0000-000000000030', 'org-spend', 'anthropic', 'claude-fable-5',
   30, 0, timestamptz '2001-09-10 00:30:00+00');

-- `set local`, so the zone is restored by the rollback at the foot of this file and no
-- later assertion inherits it.
set local timezone = 'Pacific/Kiritimati';  -- UTC+14
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.token_usage_daily
    where organization_id = 'org-spend' and day = date '2001-09-09'
      and tokens_total = 2330),
  'a session fourteen hours ahead of UTC reads the same day out of the rollup');

set local timezone = 'Pacific/Midway';      -- UTC-11
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.token_usage_daily
    where organization_id = 'org-spend' and day = date '2001-09-10'
      and tokens_total = 30),
  'and so does a session eleven hours behind it');

set local timezone = 'UTC';

-- --- one workspace's spend is one workspace's ----------------------------------------
--
-- The rollup is grouped by organization, so another workspace's ledger cannot reach this
-- one's card. Stated as an assertion because the stat is a `sum` with no join to check
-- it: a leak here would render as a plausible number rather than as an error.
insert into ouroboros.token_usage
    (organization_id, run_id, provider, model, tokens_in, tokens_out, cost_cents)
  values ('org-drift', 'e3000000-0000-0000-0000-000000000499', 'anthropic',
          'claude-fable-5', 5000000, 5000000, 99999.0000);

select pg_temp.must_hold(
  (select sum(tokens_total) = 4200000
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend'
      and day = (now() at time zone 'utc')::date),
  'another workspace''s spend does not appear in this workspace''s day');

-- --- unpriced is null, and null is not zero ------------------------------------------
--
-- Acceptance criterion: `cost_cents` is nullable and means *unpriced until #92* — never
-- defaulted to 0. Three halves to it, and each is a different way the card could lie.
--
-- First: the column takes no default, so an insert that omits it stores null rather than
-- a free call.
insert into ouroboros.token_usage
    (id, organization_id, provider, model, tokens_in, tokens_out)
  values ('e4000000-0000-0000-0000-000000001000', 'org-spend', 'ollama',
          'ollama/qwen3-coder', 1000, 500);
select pg_temp.must_hold(
  (select cost_cents is null from ouroboros.token_usage
    where id = 'e4000000-0000-0000-0000-000000001000'),
  'an event inserted without a cost is unpriced, not free');

-- Second: `sum` skips the nulls, so the day's cost is the cost of what is priced — and
-- `unpriced_events` is how a reader learns that the total is a lower bound. Both of
-- `ollama`'s events today are unpriced, and the day's cost is unchanged by them.
select pg_temp.must_hold(
  (select events = 2 and unpriced_events = 2 and cost_cents is null
      and tokens_total = 601500
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend' and provider = 'ollama'
      and day = (now() at time zone 'utc')::date),
  'a wholly unpriced provider has null cost and a non-zero unpriced_events');

select pg_temp.must_hold(
  (select sum(cost_cents) = 1860.0000 and sum(unpriced_events) = 2
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend'
      and day = (now() at time zone 'utc')::date),
  'the day''s cost is the cost of its priced events, and says how many were not');

-- Third: nothing coalesces on the way out. A day with no priced event at all must come
-- back null — the value the card renders as *cost unavailable* — rather than as `$0.00`,
-- which is a claim about money.
insert into ouroboros.token_usage
    (organization_id, provider, model, tokens_in, tokens_out, occurred_at)
  values ('org-spend', 'ollama', 'ollama/qwen3-coder', 2000, 1000,
          now() - interval '5 days');
select pg_temp.must_hold(
  (select cost_cents is null and unpriced_events = 1
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend' and provider = 'ollama'
      and day = (now() at time zone 'utc')::date - 5),
  'a day with nothing priced reports null cost, not zero');

-- Cents are stored exactly and to four places, because a single call is worth a fraction
-- of one. Rounded to whole cents these three would be 0, 0 and 0; summed as `numeric`
-- they are a tenth of a cent, and summed as `double precision` they would be nearly
-- that.
insert into ouroboros.token_usage
    (organization_id, provider, model, tokens_in, tokens_out, cost_cents, occurred_at)
  select 'org-spend', 'openai', 'gpt-5-codex', 100, 50, 0.0333,
         now() - interval '9 days'
    from generate_series(1, 3);
select pg_temp.must_hold(
  (select cost_cents = 0.0999 from ouroboros.token_usage_daily
    where organization_id = 'org-spend' and provider = 'openai'
      and day = (now() at time zone 'utc')::date - 9),
  'sub-cent costs are stored and summed exactly, not rounded to nothing');

-- --- the numbers are counts ----------------------------------------------------------
--
-- A negative token count is a parse error, not a refund, and it would subtract from the
-- card in silence. Zero is legal in either column and is not the same thing: a refused
-- call read its prompt and produced nothing.
select pg_temp.must_reject(
  $$update ouroboros.token_usage set tokens_in = -1
    where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'token_usage.tokens_in cannot go negative',
  'token_usage_tokens_in_nonnegative');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set tokens_out = -1
    where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'token_usage.tokens_out cannot go negative',
  'token_usage_tokens_out_nonnegative');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set cost_cents = -0.0001
    where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'token_usage.cost_cents cannot go negative',
  'token_usage_cost_cents_nonnegative');

insert into ouroboros.token_usage
    (id, organization_id, provider, model, tokens_in, tokens_out, cost_cents)
  values ('e4000000-0000-0000-0000-000000001001', 'org-spend', 'anthropic',
          'claude-fable-5', 1200, 0, 0.0000);
select pg_temp.must_hold(
  (select tokens_out = 0 and cost_cents = 0
     from ouroboros.token_usage where id = 'e4000000-0000-0000-0000-000000001001'),
  'zero tokens and a zero cost are storable — they are measurements, not absences');

-- --- the provider is folded, the model is not -----------------------------------------
--
-- Decision F8 leaves both opaque, so a provider nobody has heard of stores. What
-- `provider` carries beyond that is the stat's rule: the subline counts
-- `distinct provider`, so `Anthropic` beside `anthropic` would be five providers where
-- there are four, and the character class is what refuses it.
insert into ouroboros.token_usage
    (organization_id, provider, model, tokens_in, tokens_out)
  values ('org-spend', 'a-provider.nobody_has-filed', 'some/model:v2', 10, 10);
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.token_usage
    where provider = 'a-provider.nobody_has-filed'),
  'token_usage.provider takes any provider — decision F8, no catalog here');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set provider = 'Anthropic'
    where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'token_usage.provider is stored folded, so the card counts providers not spellings',
  'token_usage_provider_format');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set provider = '   '
    where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'token_usage.provider must not be blank', 'token_usage_provider_format');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set provider = repeat('p', 65)
    where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'token_usage.provider is bounded', 'token_usage_provider_format');

-- The model keeps its capitals — a model identifier is a name its provider chose, and
-- some of them carry them — but is still bounded and non-blank.
insert into ouroboros.token_usage
    (organization_id, provider, model, tokens_in, tokens_out)
  values ('org-spend', 'ollama', 'Qwen/Qwen3-Coder', 10, 10);
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.token_usage where model = 'Qwen/Qwen3-Coder'),
  'token_usage.model is not folded — capitals are the provider''s to choose');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set model = '  '
    where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'token_usage.model must not be blank', 'token_usage_model_present');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set model = repeat('m', 201)
    where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'token_usage.model is bounded', 'token_usage_model_present');

-- --- V020 — which kind of work, and how long it took (#192) ----------------------------
--
-- The two columns mockup 06's `$/run avg` and `p50 latency` are computed from, and the pair
-- of rules that keep both figures honest. Both are nullable, and **null is the point**: a
-- call the router did not place has no task kind, a call nobody timed has no latency, and
-- an aggregate over none of either is null — which is the em-dash decision M7 requires
-- instead of a fabricated `$0.00` and `0.0s`.
select pg_temp.must_hold(
  (select task_kind is null and latency_ms is null
     from ouroboros.token_usage where id = 'e4000000-0000-0000-0000-00000000000a'),
  'a usage row carries neither a task kind nor a latency by default — unrouted and untimed');

--
-- Dated twenty days back, deliberately: the day-scoped assertions further down pin *today's*
-- totals for this workspace, and a priced row landing on today would move one of them. The
-- aggregates below are scoped by task kind rather than by day, so the date costs them nothing.
insert into ouroboros.token_usage
    (id, organization_id, provider, model, tokens_in, tokens_out, cost_cents,
     task_kind, latency_ms, occurred_at)
  values ('e4000000-0000-0000-0000-000000001002', 'org-spend', 'anthropic',
          'claude-fable-5', 900, 300, 87.0000, 'commit-msg', 0,
          now() - interval '20 days');
select pg_temp.must_hold(
  (select task_kind = 'commit-msg' and latency_ms = 0
     from ouroboros.token_usage where id = 'e4000000-0000-0000-0000-000000001002'),
  'a routed call records its kind, and a zero latency is a measurement a local daemon really makes');

-- The shape `task_kinds.name` carries, so this column can only hold names that table could.
-- Deliberately **not** a foreign key (decision F8, as V008 made `runs.workflow_tag`): a
-- ledger row records what happened, and retiring the kind must not rewrite the history
-- routed under it — which is why the shape is all there is to enforce.
select pg_temp.must_reject(
  $$update ouroboros.token_usage set task_kind = 'Implement'
    where id = 'e4000000-0000-0000-0000-000000001002'$$,
  'token_usage.task_kind is shaped as a task kind name is, capitals included',
  'token_usage_task_kind_shape');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set task_kind = ' '
    where id = 'e4000000-0000-0000-0000-000000001002'$$,
  'token_usage.task_kind must not be blank', 'token_usage_task_kind_shape');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set task_kind = repeat('k', 65)
    where id = 'e4000000-0000-0000-0000-000000001002'$$,
  'token_usage.task_kind is bounded as task_kinds.name is',
  'token_usage_task_kind_shape');

-- A kind this workspace has never had still stores, which is the trade F8 buys: the ledger
-- keeps the name the call was routed under, and a name nothing recognises aggregates to a
-- visible row of its own rather than being lost at write time.
insert into ouroboros.token_usage
    (organization_id, provider, model, tokens_in, tokens_out, task_kind, occurred_at)
  values ('org-spend', 'anthropic', 'claude-fable-5', 10, 10, 'a-kind-nobody-declared',
          now() - interval '20 days');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.token_usage
    where task_kind = 'a-kind-nobody-declared'),
  'a task kind no table declares still stores — the ledger is a record, not a foreign key');

select pg_temp.must_reject(
  $$update ouroboros.token_usage set latency_ms = -1
    where id = 'e4000000-0000-0000-0000-000000001002'$$,
  'token_usage.latency_ms cannot go negative — a call does not take less than no time',
  'token_usage_latency_ms_nonnegative');

-- The aggregates the matrix is made of, over the rows above: exact, and null where there is
-- nothing to compute. The second half is the assertion the whole M7 honesty rule rests on.
select pg_temp.must_hold(
  (select avg(cost_cents) = 87.0000
      and percentile_cont(0.5) within group (order by latency_ms) = 0
     from ouroboros.token_usage
    where organization_id = 'org-spend' and task_kind = 'commit-msg'),
  'a kind''s $/run avg and p50 latency are aggregates over its calls and nothing else');

select pg_temp.must_hold(
  (select avg(cost_cents) is null
      and percentile_cont(0.5) within group (order by latency_ms) is null
     from ouroboros.token_usage
    where organization_id = 'org-spend' and task_kind = 'a-kind-with-no-calls'),
  'a kind with no calls computes null for both, which is the em-dash and not a zero');

-- --- the run, and the workspace it must agree with -------------------------------------
--
-- The rule V008 and V009 wrote for `github_repo_id`, in the shape this table needs: it
-- reaches a repository through its run rather than directly, which is why V009's shared
-- function could not be reused and `ouroboros.run_in_organization()` exists. A usage row
-- naming one workspace and another's run is one tenant's work appearing in another's
-- spend — and, once mockup 15 joins the two, in another's cost attribution.
select pg_temp.must_reject(
  $$insert into ouroboros.token_usage
      (organization_id, run_id, provider, model, tokens_in, tokens_out)
    values ('org-spend', 'e3000000-0000-0000-0000-000000000499', 'anthropic',
            'claude-fable-5', 10, 10)$$,
  'usage cannot be attributed to a run belonging to another organization',
  'token_usage_run_in_organization');

select pg_temp.must_reject(
  $$update ouroboros.token_usage
       set run_id = 'e3000000-0000-0000-0000-000000000499'
     where id = 'e4000000-0000-0000-0000-00000000000a'$$,
  'usage cannot be moved onto another organization''s run',
  'token_usage_run_in_organization');

-- With a run named, the trigger runs ahead of the organization foreign key and subsumes
-- it, exactly as the two tables above — so an organization that does not exist is
-- refused under the trigger's name.
select pg_temp.must_reject(
  $$insert into ouroboros.token_usage
      (organization_id, run_id, provider, model, tokens_in, tokens_out)
    values ('no-such-org', 'e3000000-0000-0000-0000-000000000482', 'anthropic',
            'claude-fable-5', 10, 10)$$,
  'usage naming an organization that does not exist is refused',
  'token_usage_run_in_organization');

-- With no run it does not, because there is nothing to look up: the foreign key is the
-- whole of the rule then, and it is the constraint that reports. Asserted rather than
-- left implied — the two refusals carry different names, and a caller reading them
-- should find that documented rather than surprising.
select pg_temp.must_reject(
  $$insert into ouroboros.token_usage
      (organization_id, provider, model, tokens_in, tokens_out)
    values ('no-such-org', 'anthropic', 'claude-fable-5', 10, 10)$$,
  'usage with no run naming a missing organization is refused by the foreign key',
  'token_usage_organization_id_fkey');

select pg_temp.must_reject(
  $$insert into ouroboros.token_usage
      (organization_id, run_id, provider, model, tokens_in, tokens_out)
    values ('org-spend', 'e3000000-0000-0000-0000-0000000000ff', 'anthropic',
            'claude-fable-5', 10, 10)$$,
  'token_usage.run_id references an existing run',
  'token_usage_run_id_fkey');

-- The two foreign keys are deliberately not the same: the workspace cascades, the run
-- does not. Read from the catalogue, because it is the difference between a ledger and
-- a set of rows that quietly shrinks.
select pg_temp.must_hold(
  (select count(*) = 1 from pg_constraint
    where conrelid = 'ouroboros.token_usage'::regclass and contype = 'f'
      and conname = 'token_usage_organization_id_fkey' and confdeltype = 'c'),
  'token_usage cascades from the organization it bills');

select pg_temp.must_hold(
  (select count(*) = 1 from pg_constraint
    where conrelid = 'ouroboros.token_usage'::regclass and contype = 'f'
      and conname = 'token_usage_run_id_fkey' and confdeltype = 'n'),
  'and sets run_id null rather than cascading, so a deleted run does not un-spend money');

-- --- deleting a run detaches the spend, it does not remove it ---------------------------
--
-- The character of the ledger, exercised end to end: the run goes, the events stay, the
-- day's total is unchanged and only the attribution is lost — which is the thing that
-- genuinely no longer exists. This is also the shape of a repository being disabled,
-- since `github_repos` cascades into `runs`.
delete from ouroboros.runs where id = 'e3000000-0000-0000-0000-000000000482';
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.token_usage
    where id in ('e4000000-0000-0000-0000-00000000000a',
                 'e4000000-0000-0000-0000-00000000000b')
      and run_id is null),
  'deleting a run leaves its usage events, with run_id set null');

select pg_temp.must_hold(
  (select sum(cost_cents) = 1860.0000
     from ouroboros.token_usage_daily
    where organization_id = 'org-spend'
      and day = (now() at time zone 'utc')::date),
  'and the day''s priced total is exactly what it was before the run was deleted');

-- --- the view is what it claims to be ---------------------------------------------------
--
-- A plain view, not materialized — decision F10's second half: a materialized rollup is a
-- stored total wearing another hat, stale from the first correction until something
-- refreshes it. Everything above would pass against one, since nothing above waits.
select pg_temp.must_hold(
  (select relkind = 'v' from pg_class
    where oid = 'ouroboros.token_usage_daily'::regclass),
  'token_usage_daily is a plain view, so it cannot be stale');

-- And it reads with the caller's rights rather than its owner's, so it is a convenience
-- on top of the insert-only posture rather than a way around it.
select pg_temp.must_hold(
  (select reloptions @> array['security_invoker=true'] from pg_class
    where oid = 'ouroboros.token_usage_daily'::regclass),
  'token_usage_daily is security_invoker, so it grants no read the table would not');

-- --- the indexes, and the volume they are for --------------------------------------------
--
-- Acceptance criterion: a BRIN index on `occurred_at` is present. Read from the
-- catalogue by access method rather than by name, because a b-tree called
-- `…_brin` would satisfy the name and none of the reason for it.
select pg_temp.must_hold(
  (select am.amname = 'brin'
     from pg_class c
     join pg_am am on am.oid = c.relam
    where c.oid = 'ouroboros.token_usage_occurred_at_brin'::regclass),
  'occurred_at carries a real BRIN index, not a b-tree with a hopeful name');

select pg_temp.must_hold(
  (select reloptions @> array['autosummarize=on'] from pg_class
    where oid = 'ouroboros.token_usage_occurred_at_brin'::regclass),
  'and it summarises as it fills, so the newest window is as cheap as the oldest');

-- Acceptance criterion: inserting seed volume completes in under a second. 5,000 events
-- is two orders of magnitude past what the mockup-parity seed (#68) will hold, and the
-- budget is the criterion's own — so the assertion has room for a loaded CI runner and
-- still fails on the thing it is watching for, which is an index that makes writes to
-- this table expensive.
--
-- Timed with `clock_timestamp()`, not `now()`: `now()` is the transaction's start and
-- would report every insert in this file as having taken no time at all.
create function pg_temp.must_insert_usage_within(events integer, budget interval)
returns void language plpgsql as $$
declare
  started timestamptz;
  elapsed interval;
begin
  started := clock_timestamp();

  insert into ouroboros.token_usage
      (organization_id, provider, model, tokens_in, tokens_out, occurred_at)
  select 'org-drift', 'anthropic', 'claude-fable-5', 1000, 250,
         now() - (g || ' seconds')::interval
    from generate_series(1, events) g;

  elapsed := clock_timestamp() - started;
  if elapsed > budget then
    raise exception 'FAILED: inserting % usage events took % (budget %)',
      events, elapsed, budget;
  end if;
end;
$$;

select pg_temp.must_insert_usage_within(5000, interval '1 second');

select pg_temp.must_hold(
  (select count(*) = 5001 from ouroboros.token_usage
    where organization_id = 'org-drift'),
  'and every one of them is there');

-- The plans, on a table that now holds enough rows for them to mean something.
--
-- Sequential scans are off for the reason every plan assertion in this file turns them
-- off: the claim under test is that a usable index exists at production size, not that
-- the planner prefers it over a handful of pages.
set local enable_seqscan = off;

-- The ledger's read — a window of time, whoever it belongs to. This is the BRIN's, and
-- it is what #92's re-pricing pass and any retention work will ask.
select pg_temp.must_use_index(
  $$select count(*) from ouroboros.token_usage
     where occurred_at >= now() - interval '1 hour'$$,
  'token_usage_occurred_at_brin');

-- The card's read — one workspace, one window. This is the b-tree's, and the reason
-- there are two indexes rather than one: the BRIN narrows to the window across every
-- workspace and would leave the organization to a filter, which is the wrong way round
-- for a stat rendered per workspace.
select pg_temp.must_use_index(
  $$select provider, sum(tokens_in + tokens_out) from ouroboros.token_usage
     where organization_id = 'org-spend' and occurred_at >= now() - interval '1 day'
     group by provider$$,
  'token_usage_organization_occurred_at_idx');

-- The view's own read is that b-tree's too — the organization reaches the index and the
-- day becomes a filter over the workspace's range, since `at time zone` is stable rather
-- than immutable and cannot be indexed. That is the shape #70 inherits: a caller that
-- needs the window pruned as well adds an `occurred_at` range, which the view's grouping
-- key cannot carry for it.
select pg_temp.must_use_index(
  $$select * from ouroboros.token_usage_daily
     where organization_id = 'org-spend' and day = (now() at time zone 'utc')::date$$,
  'token_usage_organization_occurred_at_idx');

-- Not a read path today: the `set null` back-reference. Without this index every run
-- deletion scans the largest table in the schema — and it is the index mockup 15's
-- per-run attribution will read, the one query that starts from a run.
select pg_temp.must_use_index(
  $$select id from ouroboros.token_usage
     where run_id = 'e3000000-0000-0000-0000-000000000499'$$,
  'token_usage_run_id_idx');

set local enable_seqscan = on;

-- --- an event is a fact, so it carries no updated_at --------------------------------------
--
-- The one table this repository creates without the V001 touch trigger, and deliberately:
-- there is no edit to an event that this table is the record of. Asserted so that a later
-- migration adding `updated_at` has to come past this line and say why.
select pg_temp.must_hold(
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'ouroboros' and table_name = 'token_usage'
      and column_name = 'updated_at'),
  'token_usage has no updated_at — an event is not edited');

select pg_temp.must_hold(
  (select count(*) = 0 from pg_trigger
    where tgrelid = 'ouroboros.token_usage'::regclass and not tgisinternal
      and tgfoid = 'ouroboros.touch_updated_at()'::regprocedure),
  'and so carries no touch trigger');

-- --- the workspace cascade ------------------------------------------------------------------
--
-- The one deletion that removes events, and it removes all of that workspace's — which is
-- what keeps every remaining total computable from what is left. End to end, one
-- statement: organization → its ledger, and organization → github_orgs → github_repos →
-- runs, whose own rows are gone rather than detached.
delete from ouroboros.organization where "id" = 'org-spend';
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.token_usage where organization_id = 'org-spend'),
  'deleting an organization takes its whole ledger with it');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.token_usage_daily
    where organization_id = 'org-spend'),
  'and the rollup empties with it, because it is an aggregate rather than a copy');

-- ===========================================================================
-- V011 — workspace_settings and workspace_settings_effective (#67)
-- ===========================================================================
--
-- The fourth table of the dashboard read-model and the only one behind a *write*: mockup
-- 02's **Auto-merge when checks pass** switch (decision F6). Nothing writes it yet either
-- — the seeds are #68 and the endpoint is #74 — so, as in the three sections above, every
-- rule the switch depends on is a database constraint here rather than an application
-- invariant.
--
-- What this section is really testing is the row-creation decision in V011's header: rows
-- are created lazily, absence means "every setting is at its default", and
-- `workspace_settings_effective` is what makes absence and an explicit default the same
-- answer to a reader. So the fixtures are two workspaces that differ in exactly that way
-- — one that has written a settings row and one that never has — and most of what
-- follows is the assertion that they read alike.
--
-- Fresh fixtures once more. `org-spend` was deleted by the cascade assertion above, and a
-- person is needed for `updated_by` that this section can delete without disturbing
-- anything earlier — Jorge (`8888…`) still carries V007's preferences row.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-switch',    'Switch Works',    'switch-works',    now()),
  ('org-untouched', 'Untouched Works', 'untouched-works', now());

insert into ouroboros."user" ("id", "name", "email", "emailVerified") values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Priya Raman',
   'priya@switch-works.example', true);

-- --- a workspace nobody has configured is off ---------------------------------------
--
-- Acceptance criterion: `auto_merge_on_checks` defaults to false for a newly created
-- organization. Both workspaces above were created a moment ago and neither has a
-- settings row, which under the lazy-creation decision is the *normal* state — so this is
-- the criterion asked exactly as the product asks it, through the view, of a workspace
-- that has never been near a settings screen.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.workspace_settings_effective
    where organization_id = 'org-untouched'),
  'every organization has exactly one row in workspace_settings_effective, row or no row');

select pg_temp.must_hold(
  (select auto_merge_on_checks = false
     from ouroboros.workspace_settings_effective
    where organization_id = 'org-untouched'),
  'a workspace with no settings row reads auto_merge_on_checks = false');

-- And the switch is genuinely the *only* place the workspace appears: absence is a state
-- of the view, not of the table.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.workspace_settings
    where organization_id = 'org-untouched'),
  'and it reads that way without a row having been written for it');

-- Nothing has happened to this workspace's settings, so the audit pair is null rather
-- than invented. Coalescing either would have to name a time at which nothing occurred.
select pg_temp.must_hold(
  (select updated_at is null and updated_by is null and not is_explicit
     from ouroboros.workspace_settings_effective
    where organization_id = 'org-untouched'),
  'an unconfigured workspace carries no audit trail and is not is_explicit');

-- --- the column default and the view default are one answer ---------------------------
--
-- The one duplication the view costs (V011's header): `false` is written as the column
-- default and again as the coalesce, and no view can spell "whatever that column
-- defaults to". This pair is what binds them — a later migration that moves one without
-- the other makes the second assertion fail, which is the whole reason it is written as
-- a comparison rather than as two separate `= false` checks.
insert into ouroboros.workspace_settings (organization_id) values ('org-switch');

select pg_temp.must_hold(
  (select auto_merge_on_checks = false from ouroboros.workspace_settings
    where organization_id = 'org-switch'),
  'a settings row written with no auto_merge_on_checks is off — the column default');

select pg_temp.must_hold(
  (select explicit.auto_merge_on_checks = absent.auto_merge_on_checks
     from ouroboros.workspace_settings_effective explicit,
          ouroboros.workspace_settings_effective absent
    where explicit.organization_id = 'org-switch'
      and absent.organization_id   = 'org-untouched'),
  'the view''s default is the column''s default — a defaulted row and no row read alike');

-- `is_explicit` is the one place the two states stay apart, for onboarding and for audit
-- lines. The value above is deliberately identical; this is not.
select pg_temp.must_hold(
  (select is_explicit from ouroboros.workspace_settings_effective
    where organization_id = 'org-switch'),
  'is_explicit is the one column that distinguishes a written default from no row');

-- --- one row per workspace ------------------------------------------------------------
--
-- The acceptance criterion, and the arbiter the settings upsert conflicts on: without it
-- two concurrent PATCHes could both find no row and both insert one, leaving the
-- workspace with two answers and the endpoint reading whichever it happened to get.
select pg_temp.must_reject(
  $$insert into ouroboros.workspace_settings (organization_id, auto_merge_on_checks)
    values ('org-switch', true)$$,
  'a second settings row for the same workspace is refused', 'workspace_settings_pkey');

-- --- settings belong to a workspace that exists -----------------------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.workspace_settings (organization_id) values ('org-nowhere')$$,
  'workspace_settings.organization_id must name a real workspace',
  'workspace_settings_organization_id_fkey');

-- --- the switch has two positions, not three --------------------------------------------
--
-- Null would be a third state — "unset" — and the point of the view is that unset is not
-- a state the product has: absence of the *row* carries it, in one place. A nullable
-- column would put that distinction in two places and let them disagree.
select pg_temp.must_reject(
  $$update ouroboros.workspace_settings set auto_merge_on_checks = null
    where organization_id = 'org-switch'$$,
  'auto_merge_on_checks cannot be null — absence of the row is the only "unset"');

-- --- the audit column names a real person ------------------------------------------------
--
-- The acceptance criterion that `updated_by` references the BetterAuth `user` table.
select pg_temp.must_reject(
  $$update ouroboros.workspace_settings set updated_by = 'nobody-at-all'
    where organization_id = 'org-switch'$$,
  'workspace_settings.updated_by must name a real person',
  'workspace_settings_updated_by_fkey');

-- --- the write path is one upsert, and it covers both arms --------------------------------
--
-- What #74's PATCH runs, verbatim. Lazy creation means the endpoint cannot know whether a
-- row exists, so the same statement has to serve the first write and every later one —
-- and both arms are exercised here, because a migration that dropped the primary key
-- would still pass an insert-only test.
--
-- The insert arm: `org-untouched` has no row.
insert into ouroboros.workspace_settings
       (organization_id, auto_merge_on_checks, updated_by)
  values ('org-untouched', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (organization_id) do update
  set auto_merge_on_checks = excluded.auto_merge_on_checks,
      updated_by           = excluded.updated_by;

select pg_temp.must_hold(
  (select auto_merge_on_checks and is_explicit
      and updated_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     from ouroboros.workspace_settings_effective
    where organization_id = 'org-untouched'),
  'the settings upsert creates the row on a workspace that had none');

-- The update arm: `org-switch` already has the defaulted row written above.
insert into ouroboros.workspace_settings
       (organization_id, auto_merge_on_checks, updated_by)
  values ('org-switch', true, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (organization_id) do update
  set auto_merge_on_checks = excluded.auto_merge_on_checks,
      updated_by           = excluded.updated_by;

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.workspace_settings
    where organization_id = 'org-switch' and auto_merge_on_checks),
  'and updates in place on a workspace that had one, rather than adding a second');

-- --- updated_at moves on its own -------------------------------------------------------
--
-- On a settings table this column answers "when did this workspace last change its
-- posture", which is the question asked of a switch nobody remembers flipping. Back-dated
-- explicitly first: every default in this file is the same transaction's `now()`, so an
-- assertion that did not supply a stale value could not fail.
select pg_temp.must_hold(
  (select tgname = 'workspace_settings_touch_updated_at' from pg_trigger
   where tgrelid = 'ouroboros.workspace_settings'::regclass and not tgisinternal),
  'workspace_settings carries the touch_updated_at trigger');

update ouroboros.workspace_settings set updated_at = '2000-01-01T00:00:00Z'
  where organization_id = 'org-switch';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.workspace_settings
   where organization_id = 'org-switch'),
  'workspace_settings.updated_at is stamped from the server clock, not from the writer');

-- --- deleting the person forgets who, not what ---------------------------------------------
--
-- The reason `updated_by` sets null rather than cascading, asserted rather than trusted.
-- A cascade here would delete the settings row when the person who last touched it left,
-- which does not un-answer the question — it silently reverts the workspace to `false`,
-- turning off a setting somebody deliberately turned on, as a side effect of an unrelated
-- account deletion. So: the attribution goes, the posture stays.
delete from ouroboros."user" where "id" = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

select pg_temp.must_hold(
  (select auto_merge_on_checks and updated_by is null
     from ouroboros.workspace_settings where organization_id = 'org-switch'),
  'deleting the person who set a switch clears the attribution and leaves the switch on');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.workspace_settings
    where organization_id = 'org-untouched' and auto_merge_on_checks),
  'and does not remove the settings row it was named on');

-- --- the view is what it claims to be -------------------------------------------------------
--
-- A plain view over a primary-key join, not a materialized one: there is nothing to
-- precompute over the smallest table in the schema, and a stale copy of a security-relevant
-- setting is worse than no copy. Every assertion above would pass against a materialized
-- view, since nothing above waits — which is why this is asked of the catalogue directly.
select pg_temp.must_hold(
  (select relkind = 'v' from pg_class
    where oid = 'ouroboros.workspace_settings_effective'::regclass),
  'workspace_settings_effective is a plain view, so it cannot be stale');

select pg_temp.must_hold(
  (select reloptions @> array['security_invoker=true'] from pg_class
    where oid = 'ouroboros.workspace_settings_effective'::regclass),
  'workspace_settings_effective is security_invoker, so it grants no read the tables would not');

-- --- the workspace cascade ---------------------------------------------------------------------
--
-- Settings for a workspace that no longer exists are unreachable by definition, and
-- leaving them would let a later workspace that reused the id inherit somebody else's
-- auto-merge posture. The view empties with it because it is a join rather than a copy.
delete from ouroboros.organization where "id" = 'org-switch';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.workspace_settings
    where organization_id = 'org-switch'),
  'deleting an organization takes its settings with it');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.workspace_settings_effective
    where organization_id = 'org-switch'),
  'and the workspace leaves the effective view entirely, rather than reverting to defaults');

-- ===========================================================================
-- V012 — model_prices, the pricing catalog (#580)
-- ===========================================================================
--
-- The first table of the model registry (mockup 21), and the only one in this schema that
-- makes a claim about money to a user. Three things are asserted here, and they are three
-- different kinds of claim:
--
--   * **What the migration put there.** Unlike every table above, this one ships with
--     rows: R__model_price_catalog.sql applies a vendored snapshot on every migration. So
--     the first assertions are about the applied catalog itself — that it is present, that
--     every row of it is provenance-stamped, and that it holds exactly one snapshot rather
--     than the union of every snapshot ever applied.
--
--   * **What the schema refuses.** The four billing modes are only structurally distinct
--     if the amount CHECKs hold, and the honesty rule the whole ticket rests on — `—` is
--     not `$0` — is only a rule if a `token` row cannot be silently free and a lookup of an
--     uncovered model cannot return a zero.
--
--   * **What the import guarantees.** Idempotency and "overrides are never touched" are
--     properties of a *statement*, not of a row, so they are asserted by running the
--     import against synthetic catalogs and reading the counts it returns.
--
-- That last group deletes the real bundled catalog on its way past — a snapshot import
-- sweeps the rows of every other snapshot, which is the point of it — so it comes last,
-- after everything that reads the shipped rows. All of it is inside the transaction this
-- file rolls back.

-- --- the applied catalog is present, and says where it came from -----------------------
--
-- Nothing here asserts a row count: the catalog is 129 rows today and will be another
-- number after the next `--vendor`, and a test that had to be edited for that would be
-- measuring the snapshot rather than the schema. What must hold for *any* snapshot is
-- asserted instead.
select pg_temp.must_hold(
  (select count(*) > 0 from ouroboros.model_prices where source = 'bundled'),
  'the migration applies a bundled price catalog rather than an empty table');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_prices
    where source = 'bundled'
      and (catalog_version is null or btrim(catalog_version) = '' or organization_id is not null)),
  'every bundled row is stamped with its snapshot and belongs to no workspace');

-- The sweep's invariant, and the reason it exists: a bundled catalog is *one* snapshot. If
-- a re-import ever stopped removing the rows of the previous one, this is where the union
-- of the two would show up.
select pg_temp.must_hold(
  (select count(distinct catalog_version) = 1 from ouroboros.model_prices
    where source = 'bundled'),
  'and the bundled rows are all from the same snapshot, not the union of several');

-- --- the anchor row, figure for figure -------------------------------------------------
--
-- Issue #580's acceptance criterion names `(anthropic, claude-fable-5)` and the figures
-- `1500¢ · 7500¢`, which are mockup 21's. **The pinned snapshot says 1000¢ · 5000¢**, and
-- the snapshot is what this table is for: the mockup is a design drawing, and a number in
-- it is a layout, not a price. Asserting the mockup's figures here would mean either
-- fabricating rows to match a drawing — the one thing decision R4 exists to prevent — or
-- asserting nothing. So the criterion is asserted in the two halves that are actually
-- load-bearing: the *shape* is `{token, both amounts, a catalog version}`, and the
-- *figures* are whatever the pinned extract carries, named exactly so that a re-vendor has
-- to come past this line and change it deliberately.
select pg_temp.must_hold(
  (select billing_mode = 'token'
          and input_cents_per_1m  = 1000
          and output_cents_per_1m = 5000
          and catalog_version is not null
          and source = 'bundled'
     from ouroboros.model_price(null, 'anthropic', 'claude-fable-5')),
  'lookup(anthropic, claude-fable-5) is the pinned snapshot''s token price, provenance and all');

-- --- the four shapes mockup 21 renders, and the fifth that is an absence ----------------
--
-- Every row of that column is one of these five answers, and the read path chooses between
-- them on `billing_mode` alone — which is only safe because the CHECKs asserted further
-- down make the amounts follow the mode.
select pg_temp.must_hold(
  (select billing_mode = 'seat' and match_model = '*'
          and input_cents_per_1m is null and output_cents_per_1m is null
     from ouroboros.model_price(null, 'copilot', 'gpt-5-codex')),
  'a Copilot model resolves to the seat family row — "seat-based", and no per-token amount');

select pg_temp.must_hold(
  (select billing_mode = 'usage'
     from ouroboros.model_price(null, 'cursor', 'composer-2')),
  'a Cursor model resolves to the usage family row — "usage-based"');

select pg_temp.must_hold(
  (select billing_mode = 'free'
     from ouroboros.model_price(null, 'ollama', 'qwen3-coder:32b')),
  'a locally served Ollama model resolves to free — "$0", by kind rather than by model');

-- **The honesty line, asserted explicitly**, because it is the difference between "we do
-- not know" and "it is free" and nothing else in this file would catch a lookup that
-- learned to invent a zero. Two ways of not knowing: a model the catalog does not cover,
-- and mockup 21's unbound alias, which names a model and no provider at all.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_price(null, 'openai_compatible', 'gpt-5.2-preview')),
  'a model the catalog does not cover returns no row — the read path renders "—", never "$0"');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_price(null, null, 'gpt-5.2-preview')),
  'and an unbound alias, which names no provider, resolves to nothing at all');

-- Deliberately *not* free: the OpenAI-compatible kind fronts a local vLLM and
-- api.openai.com alike, so a bundled free row for it would price every uncovered OpenAI
-- model at zero. V012's header argues this at length; this is the assertion that would
-- notice somebody adding that row for the mockup's sake.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_prices
    where source = 'bundled' and match_provider_kind = 'openai_compatible'
      and match_model = '*'),
  'no bundled family row prices the OpenAI-compatible kind — local-ness belongs to a connection');

-- --- one indexed query ----------------------------------------------------------------
--
-- The acceptance criterion is that the lookup resolves in one indexed query, and this is
-- the assertion of it: `ouroboros.model_price()` is `language sql` and `stable` precisely
-- so PostgreSQL inlines it, which means the plan a caller gets is the plan below. A
-- plpgsql rewrite would satisfy every behavioural assertion above and fail this one,
-- which is the point — it would turn every price lookup into an opaque function scan.
--
-- Sequential scans off for the reason lib/assert.sql gives: what is asserted is that a
-- usable index exists, not that the planner prefers it over a hundred-row table.
set local enable_seqscan = off;

select pg_temp.must_use_index(
  $$select * from ouroboros.model_price('org-price', 'anthropic', 'claude-fable-5')$$,
  'model_prices_lookup_idx');

-- The sweep's index, which is the other read this table has: one statement per snapshot
-- bump over the whole bundled catalog.
select pg_temp.must_use_index(
  $$select id from ouroboros.model_prices
     where source = 'bundled' and catalog_version <> '2026-08-15+litellm.70d51a1'$$,
  'model_prices_bundled_version_idx');

set local enable_seqscan = on;

-- --- what the schema refuses -----------------------------------------------------------
--
-- The four amount rules first, which are what make the four shapes structural. Each names
-- its own constraint, so a row rejected by some *other* rule — a not-null, the mode
-- vocabulary — reads as the failure it is rather than as a passing assertion.
select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, source, catalog_version)
    values ('anthropic', 'half-priced', 'token', 100, 'bundled', 'test')$$,
  'a token row with only one of its two amounts is refused',
  'model_prices_token_requires_amounts');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('anthropic', 'costs-nothing', 'token', 0, 0, 'bundled', 'test')$$,
  'a token row that costs nothing in both directions is refused — that row is free, mislabelled',
  'model_prices_token_amounts_meaningful');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('ollama', 'not-really-free', 'free', 50, 0, 'bundled', 'test')$$,
  'a free row carrying a non-zero amount is refused',
  'model_prices_free_amounts_zero');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('copilot', 'seat-with-a-rate', 'seat', 100, 500, 'bundled', 'test')$$,
  'a seat row carrying per-token amounts is refused — there is no reading of that number',
  'model_prices_metered_amounts_absent');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('anthropic', 'refund-model', 'token', -100, 500, 'bundled', 'test')$$,
  'a negative rate is refused — it would subtract from a total silently',
  'model_prices_amounts_nonnegative');

-- Provenance, which is the other half of the honesty posture: a row must say where it came
-- from, and the two ways of saying it must agree. A bundled row naming a workspace would
-- put an override inside the reach of the sweep.
select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (organization_id, match_provider_kind, match_model, billing_mode,
       input_cents_per_1m, output_cents_per_1m, source, catalog_version)
    values ('org-acme', 'anthropic', 'claimed-bundled', 'token', 1, 1, 'bundled', 'test')$$,
  'a bundled row naming a workspace is refused',
  'model_prices_source_matches_owner');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('anthropic', 'orphan-override', 'token', 1, 1, 'override', null)$$,
  'and an override belonging to nobody is refused too',
  'model_prices_source_matches_owner');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('anthropic', 'unversioned', 'token', 1, 1, 'bundled', null)$$,
  'a bundled row with no snapshot version is refused — nothing could ever sweep it',
  'model_prices_catalog_version_for_bundled');

-- The lookup key. The `*` rules are what keep "the glob is `*` and nothing else" a rule
-- rather than a convention, and the folding rule is what stops a capital letter rendering
-- `—` for a model that has a price.
select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('anthropic', 'claude-*', 'token', 1, 1, 'bundled', 'test')$$,
  'a prefix glob in a model identifier is refused — the only wildcard is a whole "*"',
  'model_prices_match_model_format');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('Anthropic', 'claude-sonnet-5', 'token', 1, 1, 'bundled', 'test')$$,
  'an unfolded provider kind is refused — Anthropic and anthropic are one kind',
  'model_prices_match_provider_kind_format');

select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version, meta)
    values ('anthropic', 'bad-meta', 'token', 1, 1, 'bundled', 'test', '"a string"'::jsonb)$$,
  'meta that is not an object is refused — #585 reads fields off it',
  'model_prices_meta_is_object');

-- The two vocabularies this table does own, unlike the provider kind beside them.
select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, source, catalog_version)
    values ('anthropic', 'invented-mode', 'subscription', 'bundled', 'test')$$,
  'a fifth billing mode is refused — each of the four has a rule in V012',
  'model_prices_billing_mode');

-- **`nulls not distinct`, asserted.** Under PostgreSQL's default every bundled row would be
-- unique against every other one — they all have a null `organization_id` — and a
-- re-import would add a second `claude-fable-5` instead of updating the first. This is the
-- assertion that the constraint carries the modifier, and it is worth more than it looks:
-- nothing else in this file, and nothing in the import's own behaviour, would look
-- different on the day somebody dropped it.
select pg_temp.must_reject(
  $$insert into ouroboros.model_prices
      (match_provider_kind, match_model, billing_mode, input_cents_per_1m, output_cents_per_1m,
       source, catalog_version)
    values ('anthropic', 'claude-fable-5', 'token', 1, 1, 'bundled', 'test')$$,
  'a second bundled row for the same model is refused, null workspace and all',
  'model_prices_match_key');

-- --- precedence: an override wins, and only for the workspace that set it ---------------
--
-- The fixtures are two workspaces that differ in exactly what is being tested: one has
-- corrected a price for itself, the other has not and reads the catalog.
insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata") values
  ('org-price',  'Priced Co',   'priced-co',   now(), null),
  ('org-nprice', 'Unpriced Co', 'unpriced-co', now(), null);

insert into ouroboros.model_prices
  (organization_id, match_provider_kind, match_model, billing_mode,
   input_cents_per_1m, output_cents_per_1m, source)
values ('org-price', 'anthropic', 'claude-fable-5', 'token', 111, 222, 'override');

select pg_temp.must_hold(
  (select source = 'override' and input_cents_per_1m = 111 and catalog_version is null
     from ouroboros.model_price('org-price', 'anthropic', 'claude-fable-5')),
  'a workspace''s override wins over the bundled row, and carries no snapshot version');

select pg_temp.must_hold(
  (select source = 'bundled' and input_cents_per_1m = 1000
     from ouroboros.model_price('org-nprice', 'anthropic', 'claude-fable-5')),
  'and only for that workspace — everyone else still reads the catalog');

-- An override *family* row beating a bundled *exact* row, which is the precedence rule that
-- is not obvious: the workspace has seen its own invoice and the snapshot has seen a public
-- price list. This is also how the mockup's `llama-4-maverick` renders `$0` — the local
-- endpoint is a fact about the connection, so the workspace states it once.
insert into ouroboros.model_prices
  (organization_id, match_provider_kind, match_model, billing_mode, source)
values ('org-price', 'openai_compatible', '*', 'free', 'override');

select pg_temp.must_hold(
  (select billing_mode = 'free' and source = 'override'
     from ouroboros.model_price('org-price', 'openai_compatible', 'gpt-5-codex')),
  'a workspace''s family override beats a bundled exact row — it has seen the invoice');

select pg_temp.must_hold(
  (select billing_mode = 'token' and source = 'bundled'
     from ouroboros.model_price('org-nprice', 'openai_compatible', 'gpt-5-codex')),
  'and the workspace next door, which said nothing, still pays the published rate');

-- --- the import, against synthetic catalogs --------------------------------------------
--
-- Everything from here down runs the import for itself, which sweeps the shipped catalog —
-- so it is last. What is being asserted is the *statement's* behaviour, and the counts it
-- returns are how: inside one transaction `now()` is frozen, so `updated_at` cannot
-- witness a write that did not happen, and a row count cannot tell "updated to the same
-- values" from "left alone". The counts can, and `ctid` is the second witness — an updated
-- row is a new heap tuple even within a transaction, so a `ctid` that has not moved is a
-- row nothing wrote to.
create temp table price_import_probe (label text primary key, inserted bigint, updated bigint,
                                      unchanged bigint, deleted bigint);

insert into price_import_probe
select 'first', * from ouroboros.import_model_price_catalog(
  'test-catalog-1', '2026-01-01T00:00:00Z'::timestamptz,
  $probe$[
    {"match_provider_kind": "anthropic", "match_model": "probe-one", "billing_mode": "token",
     "input_cents_per_1m": 100, "output_cents_per_1m": 500, "meta": {"context_tokens": 1000}},
    {"match_provider_kind": "anthropic", "match_model": "probe-two", "billing_mode": "token",
     "input_cents_per_1m": 200, "output_cents_per_1m": 600}
  ]$probe$::jsonb);

select pg_temp.must_hold(
  (select inserted = 2 and updated = 0 and unchanged = 0 and deleted > 0
     from price_import_probe where label = 'first'),
  'a new snapshot inserts its rows and sweeps every bundled row of the one before it');

create temp table price_import_ctid as
  select match_model, ctid as tuple from ouroboros.model_prices where source = 'bundled';

-- The idempotency criterion, literally: the same arguments a second time.
insert into price_import_probe
select 'second', * from ouroboros.import_model_price_catalog(
  'test-catalog-1', '2026-01-01T00:00:00Z'::timestamptz,
  $probe$[
    {"match_provider_kind": "anthropic", "match_model": "probe-one", "billing_mode": "token",
     "input_cents_per_1m": 100, "output_cents_per_1m": 500, "meta": {"context_tokens": 1000}},
    {"match_provider_kind": "anthropic", "match_model": "probe-two", "billing_mode": "token",
     "input_cents_per_1m": 200, "output_cents_per_1m": 600}
  ]$probe$::jsonb);

select pg_temp.must_hold(
  (select inserted = 0 and updated = 0 and unchanged = 2 and deleted = 0
     from price_import_probe where label = 'second'),
  'running the same snapshot again changes nothing — nothing inserted, updated or deleted');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.model_prices p
     join price_import_ctid b on b.match_model = p.match_model and b.tuple = p.ctid
    where p.source = 'bundled'),
  'and not one bundled row was rewritten in place, which is what a frozen updated_at cannot say');

-- A *newer* snapshot: one row re-priced, one row dropped upstream, and the overrides two
-- workspaces set watching the whole thing happen.
create temp table price_override_before as
  select id, ctid as tuple, input_cents_per_1m, billing_mode
    from ouroboros.model_prices where source = 'override';

insert into price_import_probe
select 'newer', * from ouroboros.import_model_price_catalog(
  'test-catalog-2', '2026-02-01T00:00:00Z'::timestamptz,
  $probe$[
    {"match_provider_kind": "anthropic", "match_model": "probe-one", "billing_mode": "token",
     "input_cents_per_1m": 150, "output_cents_per_1m": 500, "meta": {"context_tokens": 1000}}
  ]$probe$::jsonb);

select pg_temp.must_hold(
  (select inserted = 0 and updated = 1 and unchanged = 0 and deleted = 1
     from price_import_probe where label = 'newer'),
  'a newer snapshot re-prices the row it still carries and sweeps the one it dropped');

select pg_temp.must_hold(
  (select input_cents_per_1m = 150 and catalog_version = 'test-catalog-2'
          and effective_at = '2026-02-01T00:00:00Z'::timestamptz
     from ouroboros.model_price(null, 'anthropic', 'probe-one')),
  'and the surviving row carries the new price, the new version and the new effective date');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_price(null, 'anthropic', 'probe-two')),
  'while the dropped model resolves to nothing rather than to last month''s price');

-- The criterion the whole override design rests on: **two imports later, not one byte of a
-- workspace's own row has moved.** `ctid` included, so "untouched" means untouched rather
-- than rewritten with the same values.
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.model_prices p
     join price_override_before b using (id)
    where p.ctid = b.tuple and p.input_cents_per_1m is not distinct from b.input_cents_per_1m
      and p.billing_mode = b.billing_mode and p.source = 'override'),
  'no import ever touches an override — not its values, and not its row');

-- --- an import that cannot be trusted is refused rather than half-applied ---------------
--
-- Class 22 (data exception): the argument is wrong, not the row. must_raise rather than
-- must_reject for exactly that reason — see lib/assert.sql.
select pg_temp.must_raise(
  $$select ouroboros.import_model_price_catalog(null, now(), '[]'::jsonb)$$,
  '22023',
  'a bundled catalog with no version is refused — its rows could never be swept');

select pg_temp.must_raise(
  $$select ouroboros.import_model_price_catalog('v', null, '[]'::jsonb)$$,
  '22023',
  'and one that does not say when it took effect');

select pg_temp.must_raise(
  $$select ouroboros.import_model_price_catalog('v', now(), '{"not": "an array"}'::jsonb)$$,
  '22023',
  'a catalog that is not a jsonb array is refused before anything is written');

-- Two entries for one model would otherwise fail as PostgreSQL's "cannot affect row a
-- second time", which names neither the model nor the file that produced it.
select pg_temp.must_raise(
  $$select ouroboros.import_model_price_catalog('v', now(),
      '[{"match_provider_kind": "anthropic", "match_model": "twice", "billing_mode": "free"},
        {"match_provider_kind": "anthropic", "match_model": "twice", "billing_mode": "free"}]'::jsonb)$$,
  '22023',
  'a catalog that prices the same model twice is refused, naming the count');

-- --- the workspace cascade --------------------------------------------------------------
--
-- An override for a workspace that no longer exists is unreachable, and leaving it would
-- let a later workspace that reused the id inherit somebody else's negotiated rate — a
-- wrong number on an invoice, arrived at by a deletion nobody connected to pricing.
delete from ouroboros.organization where "id" = 'org-price';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_prices where organization_id = 'org-price'),
  'deleting a workspace takes its price overrides with it');

select pg_temp.must_hold(
  (select count(*) > 0 from ouroboros.model_prices where source = 'bundled'),
  'and leaves the bundled catalog alone, which belongs to no workspace');

-- ===========================================================================
-- V013 — tenant_keys, the sealed per-workspace data-encryption keys (#222)
-- ===========================================================================
--
-- The database half of the envelope-encryption service (decision P2). Everything the
-- vault relies on this table for is a rule here rather than an application invariant,
-- because the failures are all silent ones: a second active version does not raise
-- anything, it splits a workspace's ciphertext across two keys; a key that survived its
-- workspace does not raise anything either, it just means the deletion did not shred
-- what it claimed to.
--
-- What the *service* guarantees — that a ciphertext is bound to its tenant and record by
-- AAD, that a bit flip fails authentication, that a re-wrap leaves data ciphertext
-- byte-identical — cannot be asserted here: the key material is never in this database in
-- a form SQL can use, which is the point of the table. Those live in ouroboros-rest's
-- vault suites.

insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata") values
  ('org-vault',  'Vault Co',  'vault-co',  now(), null),
  ('org-vault2', 'Vault Two', 'vault-two', now(), null);

-- --- one active version per workspace ---------------------------------------------------
--
-- The rule the whole rotation design rests on, and the one place two concurrent rotations
-- meet. A retired row beside the active one is the normal state during a sweep, so the
-- assertion has to distinguish "a second row" from "a second *active* row".
insert into ouroboros.tenant_keys (organization_id, version, sealed_dek, wrapper)
values ('org-vault', 1, '\x00'::bytea, 'env-master');

select pg_temp.must_reject(
  $$insert into ouroboros.tenant_keys (organization_id, version, sealed_dek, wrapper)
    values ('org-vault', 2, '\x00'::bytea, 'env-master')$$,
  'a second active key version for one workspace is refused',
  'tenant_keys_one_active_idx');

update ouroboros.tenant_keys
   set status = 'retired', rotated_at = now()
 where organization_id = 'org-vault' and version = 1;

insert into ouroboros.tenant_keys (organization_id, version, sealed_dek, wrapper)
values ('org-vault', 2, '\x00'::bytea, 'env-master');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.tenant_keys where organization_id = 'org-vault'),
  'but a retired version coexists with the active one — rotation is additive, so ciphertext sealed under the old key stays readable');

-- Two workspaces may each have an active version: the index is partial *and* per
-- organization, and an index that had accidentally been global would fail here rather
-- than in production on the second workspace ever to store a secret.
insert into ouroboros.tenant_keys (organization_id, version, sealed_dek, wrapper)
values ('org-vault2', 1, '\x00'::bytea, 'env-master');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.tenant_keys where status = 'active'),
  'and two workspaces each hold an active version of their own');

-- The encrypt path's lookup: this workspace's active version. A sequential scan here is a
-- table scan on every secret written, so the index is asserted rather than assumed.
select pg_temp.must_use_index(
  $$select version from ouroboros.tenant_keys
     where organization_id = 'org-vault' and status = 'active'$$,
  'tenant_keys_one_active_idx');

-- --- a version is identified by the pair, and starts at one -----------------------------
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_keys (organization_id, version, sealed_dek, wrapper, status, rotated_at)
    values ('org-vault', 1, '\x01'::bytea, 'env-master', 'retired', now())$$,
  'a version number cannot be reused within a workspace',
  'tenant_keys_pkey');

select pg_temp.must_reject(
  $$insert into ouroboros.tenant_keys (organization_id, version, sealed_dek, wrapper)
    values ('org-vault2', 0, '\x00'::bytea, 'env-master')$$,
  'version zero is refused — zero is what a caller supplies when it meant to supply nothing',
  'tenant_keys_version_check');

-- --- status and rotated_at are one fact -------------------------------------------------
--
-- Both directions, because either one alone would leave "is this key still in use" with
-- two answers that can disagree.
select pg_temp.must_reject(
  $$update ouroboros.tenant_keys set status = 'retired'
     where organization_id = 'org-vault2' and version = 1$$,
  'a version cannot be retired without recording when',
  'tenant_keys_retired_is_stamped');

select pg_temp.must_reject(
  $$update ouroboros.tenant_keys set rotated_at = now()
     where organization_id = 'org-vault2' and version = 1$$,
  'and an active version cannot claim to have been rotated away from',
  'tenant_keys_retired_is_stamped');

select pg_temp.must_reject(
  $$insert into ouroboros.tenant_keys (organization_id, version, sealed_dek, wrapper, status)
    values ('org-vault2', 2, '\x00'::bytea, 'env-master', 'destroyed')$$,
  'and the only two states are active and retired',
  'tenant_keys_status_check');

-- --- updated_at is the server's account, not the writer's --------------------------------
--
-- A re-wrap updates sealed_dek and wrapper, and the time it did so is what an operator
-- reads when asking whether a custody migration finished. A writer that could set it could
-- report a re-wrap as older than it is.
-- A CTE rather than a sub-select: PostgreSQL admits a data-modifying statement only at the
-- top level of a `with`, so `update … returning` cannot be read from a `from (…)`.
with rewrapped as (
  update ouroboros.tenant_keys
     set wrapper = 'aws-kms', updated_at = '1999-01-01'::timestamptz
   where organization_id = 'org-vault2' and version = 1
  returning updated_at
)
select pg_temp.must_hold(
  (select updated_at > '2000-01-01'::timestamptz from rewrapped),
  'the touch trigger overwrites an updated_at a re-wrap tried to supply');

-- --- crypto-shredding -------------------------------------------------------------------
--
-- The strongest claim this schema makes, and the cheapest one to break by writing
-- `on delete set null` out of habit. Deleting the workspace destroys the key, and
-- destroying the key is what makes that workspace's credential ciphertext unrecoverable
-- from backups that still hold it.
delete from ouroboros.organization where "id" = 'org-vault';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.tenant_keys where organization_id = 'org-vault'),
  'deleting a workspace destroys every version of its data-encryption key — every version, not just the active one');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_keys where organization_id = 'org-vault2'),
  'and leaves every other workspace''s keys alone');

-- ===========================================================================
-- V014 — github_issues, the intake mirror and its sync cursor (#99)
-- ===========================================================================
--
-- The first table of the intake read-model, and the one mockup 03's backlog table and
-- detail panel are both views over. Nothing writes it yet — the sync service is K.4
-- (#102) and the estimator that moves `sizing_status` is K.2/L.3 — so, as with the
-- dashboard tables above, every rule a reader depends on is a constraint here rather than
-- an application invariant.
--
-- Decision **K3** is what most of this section is really about: the table is a *cache*,
-- and GitHub is the source of truth. The assertions therefore fall in two groups — the
-- mirrored columns, which must refuse anything GitHub could not have produced, and the
-- one column this product owns (`sizing_status`), which must refuse anything the sizing
-- pipeline does not name.
--
-- Its own fixtures again: the V013 section deleted `org-vault`, and every
-- organization-with-a-repository pair from the sections above went with the workspaces
-- they hung off. Two fresh workspaces, for the reason V008 and V009 needed two — one to
-- own the issues, one to own a repository they must not be allowed to name.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-intake', 'Intake Works', 'intake-works', now()),
  ('org-astray', 'Astray Works', 'astray-works', now());

insert into ouroboros.github_orgs (id, organization_id, login, enabled) values
  ('d0000000-0000-0000-0000-00000000000a', 'org-intake', 'intake-works', true),
  ('d0000000-0000-0000-0000-00000000000b', 'org-astray', 'astray-works', true);

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch) values
  ('dfff0000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a',
   'helios-firmware', true, 'main'),
  ('dfff0000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b',
   'astray-firmware', true, 'main');

-- --- one issue, exactly as the panel renders one -----------------------------
-- Mockup 03's `#485`: `Watchdog reset on I²C bus lockup`, the four labels of the detail
-- panel's tag row, `opened 2d ago by field-support`, and a body for the excerpt.
insert into ouroboros.github_issues
    (id, organization_id, github_repo_id, number, title, body, state, labels,
     author_login, gh_created_at, gh_updated_at, gh_url)
  values ('d1000000-0000-0000-0000-000000000485', 'org-intake',
          'dfff0000-0000-0000-0000-00000000000a', 485,
          'Watchdog reset on I²C bus lockup',
          'Unit 07 in the Fremont pilot rebooted 14 times overnight.',
          'open', '["bug", "i2c", "watchdog", "priority-high"]'::jsonb,
          'field-support', now() - interval '2 days', now() - interval '3 hours',
          'https://github.com/nobudata/helios-firmware/issues/485');

-- Acceptance criterion: the default is `unsized`. A freshly mirrored issue has no
-- estimate, and the sync writes issues rather than estimates — a row arriving as anything
-- else would claim one that does not exist. The empty label array is the same argument:
-- "no labels" is the common case and is what renders as no tags.
select pg_temp.must_hold(
  (select sizing_status = 'unsized'
     from ouroboros.github_issues where id = 'd1000000-0000-0000-0000-000000000485'),
  'a mirrored issue arrives unsized');

insert into ouroboros.github_issues
    (id, organization_id, github_repo_id, number, title, state,
     gh_created_at, gh_updated_at, gh_url)
  values ('d1000000-0000-0000-0000-000000000491', 'org-intake',
          'dfff0000-0000-0000-0000-00000000000a', 491,
          'Add CRC32 to config persistence layer', 'open',
          now() - interval '5 days', now() - interval '5 days',
          'https://github.com/nobudata/helios-firmware/issues/491');

select pg_temp.must_hold(
  (select labels = '[]'::jsonb and body is null and author_login is null
     from ouroboros.github_issues where id = 'd1000000-0000-0000-0000-000000000491'),
  'an issue with no labels, no description and a deleted author is representable');

-- --- one row per issue, and the number is the repository's ---------------------
--
-- Acceptance criterion: unique `(github_repo_id, number)` holds. This is also the key
-- K.4's upsert conflicts on, so a missing one would not be a duplicate-row bug — it would
-- be a sync that inserted the whole backlog again on every poll.
select pg_temp.must_reject(
  $$insert into ouroboros.github_issues
      (organization_id, github_repo_id, number, title, state,
       gh_created_at, gh_updated_at, gh_url)
    values ('org-intake', 'dfff0000-0000-0000-0000-00000000000a', 485, 'Mirrored twice',
            'open', now(), now(), 'https://github.com/nobudata/helios-firmware/issues/485')$$,
  'the same issue number cannot be mirrored twice for one repository',
  'github_issues_repo_number_key');

-- And the other half of *within the repository*: the same number under a different
-- repository is a different issue, which is why the key is not `(organization_id,
-- number)`. Both repositories are this workspace's for the length of this assertion — the
-- one owned by `org-astray` is needed intact for the tenancy assertion below, so the
-- second `#485` is written against a repository of `org-intake`'s own.
insert into ouroboros.github_repos (id, org_id, name, enabled) values
  ('dfff0000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000a',
   'helios-tooling', true);

insert into ouroboros.github_issues
    (organization_id, github_repo_id, number, title, state,
     gh_created_at, gh_updated_at, gh_url)
  values ('org-intake', 'dfff0000-0000-0000-0000-00000000000c', 485, 'A different #485',
          'open', now(), now(), 'https://github.com/nobudata/helios-tooling/issues/485');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.github_issues
    where organization_id = 'org-intake' and number = 485),
  'two repositories in one workspace may each have a #485');

-- --- the two vocabularies are closed ------------------------------------------
--
-- Acceptance criterion: `sizing_status` rejects an unknown value. Both columns partition
-- something the screen renders — the *State* select over one, the status pill and the
-- page head's sized count over the other — so a value outside either set is a row that
-- appears under no filter and in no count.
select pg_temp.must_reject(
  $$update ouroboros.github_issues set sizing_status = 'guessing'
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'github_issues.sizing_status rejects a value outside the four K4 names',
  'github_issues_sizing_status');

select pg_temp.must_reject(
  $$update ouroboros.github_issues set state = 'draft'
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'github_issues.state rejects anything but GitHub''s own two',
  'github_issues_state');

-- And every named value is storable — each CHECK is a vocabulary, not a subset of one.
update ouroboros.github_issues set sizing_status = 'estimating'
  where id = 'd1000000-0000-0000-0000-000000000485';
update ouroboros.github_issues set sizing_status = 'needs_human'
  where id = 'd1000000-0000-0000-0000-000000000485';
update ouroboros.github_issues set sizing_status = 'sized', state = 'closed'
  where id = 'd1000000-0000-0000-0000-000000000485';

select pg_temp.must_hold(
  (select sizing_status = 'sized' and state = 'closed'
     from ouroboros.github_issues where id = 'd1000000-0000-0000-0000-000000000485'),
  'every sizing status K4 names, and both states GitHub has, are storable');

update ouroboros.github_issues set sizing_status = 'unsized', state = 'open'
  where id = 'd1000000-0000-0000-0000-000000000485';

-- --- the labels are a list of names -------------------------------------------
--
-- `jsonb` on its own accepts an object, a number and a bare string, and the GIN index
-- would store all three quite happily. What the tags renderer and the chip-set filter
-- depend on is narrower, and each of these is a shape a plausible mapping bug produces:
-- GitHub's own payload is a list of label *objects*, so `["bug", …]` versus
-- `[{"name": "bug"}, …]` is one `.map()` apart.
select pg_temp.must_reject(
  $$update ouroboros.github_issues set labels = '[{"name": "bug"}]'::jsonb
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'labels rejects GitHub''s label objects — the column holds names',
  'github_issues_labels_shape');

select pg_temp.must_reject(
  $$update ouroboros.github_issues set labels = '["bug", 3]'::jsonb
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'labels rejects an element that is not a string', 'github_issues_labels_shape');

select pg_temp.must_reject(
  $$update ouroboros.github_issues set labels = '"bug"'::jsonb
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'labels rejects a bare string where an array belongs', 'github_issues_labels_shape');

select pg_temp.must_reject(
  $$update ouroboros.github_issues set labels = '["bug", ""]'::jsonb
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'labels rejects the empty name — a chip with nothing on it',
  'github_issues_labels_shape');

-- GitHub's own cap, so the GIN index cannot be handed an unbounded array by one row.
select pg_temp.must_reject(
  $$update ouroboros.github_issues
       set labels = (select jsonb_agg('label-' || g) from generate_series(1, 101) g)
     where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'labels rejects more names than GitHub permits on one issue',
  'github_issues_labels_shape');

-- --- the URL is a link, not a scheme ------------------------------------------
--
-- The one constraint here that is a safety rule rather than a shape rule: `gh_url` is the
-- `href` of *"Open on GitHub ↗"*, and an href is a place `javascript:` executes rather
-- than navigates. Refused in the column, so no renderer has to remember to check — and
-- the writer is an HTTP client parsing somebody else's JSON.
select pg_temp.must_reject(
  $$update ouroboros.github_issues set gh_url = 'javascript:alert(1)'
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'gh_url refuses a scheme that executes rather than navigates',
  'github_issues_url_https');

select pg_temp.must_reject(
  $$update ouroboros.github_issues set gh_url = 'http://github.com/a/b/issues/1'
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'gh_url refuses plain http', 'github_issues_url_https');

-- And a GitHub Enterprise Server URL is accepted, which is why the constraint checks the
-- scheme and a host rather than the github.com path shape.
update ouroboros.github_issues set gh_url = 'https://git.internal.example:8443/eng/helios/issues/485'
  where id = 'd1000000-0000-0000-0000-000000000485';

select pg_temp.must_hold(
  (select gh_url like 'https://git.internal.example:8443/%'
     from ouroboros.github_issues where id = 'd1000000-0000-0000-0000-000000000485'),
  'gh_url accepts a GitHub Enterprise Server host');

update ouroboros.github_issues set gh_url = 'https://github.com/nobudata/helios-firmware/issues/485'
  where id = 'd1000000-0000-0000-0000-000000000485';

-- --- the mirrored strings are ones GitHub could have issued --------------------
--
-- `author_login` keeps its case, unlike V003's org login: folding a mirrored value would
-- be an edit, and K3 forbids edits. The format is still GitHub's, so a value that could
-- not be a login cannot be stored as one.
update ouroboros.github_issues set author_login = 'Field-Support'
  where id = 'd1000000-0000-0000-0000-000000000485';

select pg_temp.must_hold(
  (select author_login = 'Field-Support'
     from ouroboros.github_issues where id = 'd1000000-0000-0000-0000-000000000485'),
  'author_login keeps the case GitHub returned — a mirror does not fold');

select pg_temp.must_reject(
  $$update ouroboros.github_issues set author_login = '-field-support-'
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'author_login refuses a value GitHub could not have issued',
  'github_issues_author_login_format');

update ouroboros.github_issues set author_login = 'field-support'
  where id = 'd1000000-0000-0000-0000-000000000485';

select pg_temp.must_reject(
  $$update ouroboros.github_issues set title = '   '
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'a mirrored issue has a title that says something',
  'github_issues_title_present');

select pg_temp.must_reject(
  $$update ouroboros.github_issues set number = 0
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'there is no issue #0', 'github_issues_number_positive');

-- --- GitHub's two timestamps agree with each other -----------------------------
--
-- Not a rule about GitHub, which never produces this pair — a rule about the mapping. The
-- two fields are adjacent in the payload and swapping them would render an issue opened
-- after it was last touched, and would poison the `since` watermark drawn from the column.
select pg_temp.must_reject(
  $$update ouroboros.github_issues set gh_updated_at = gh_created_at - interval '1 day'
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'an issue cannot have been updated before it was opened',
  'github_issues_updated_after_created');

-- --- one workspace's issues do not appear on another's backlog ------------------
--
-- V009's shared trigger, third table. The failure it prevents is not a broken join: it is
-- Astray's issue titles rendering on Intake's backlog, which is a tenancy leak.
select pg_temp.must_reject(
  $$insert into ouroboros.github_issues
      (organization_id, github_repo_id, number, title, state,
       gh_created_at, gh_updated_at, gh_url)
    values ('org-intake', 'dfff0000-0000-0000-0000-00000000000b', 700, 'Not ours',
            'open', now(), now(), 'https://github.com/astray/astray-firmware/issues/700')$$,
  'an issue cannot name a repository belonging to another organization',
  'github_issues_repo_in_organization');

-- And on the way through, which is why the trigger fires on UPDATE as well.
select pg_temp.must_reject(
  $$update ouroboros.github_issues set github_repo_id = 'dfff0000-0000-0000-0000-00000000000b'
    where id = 'd1000000-0000-0000-0000-000000000485'$$,
  'an issue cannot be moved onto another organization''s repository',
  'github_issues_repo_in_organization');

-- --- synced_at and updated_at are different clocks ------------------------------
--
-- The freshness distinction K2 asks for: `synced_at` says when GitHub was last asked,
-- `updated_at` says when this row last changed. A poll that re-read an unchanged issue
-- moves the first and not the second — and `updated_at` is the server's to set, so a
-- writer cannot backdate what it did.
update ouroboros.github_issues set updated_at = '2000-01-01T00:00:00Z'
  where id = 'd1000000-0000-0000-0000-000000000485';

select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.github_issues
    where id = 'd1000000-0000-0000-0000-000000000485'),
  'github_issues.updated_at is stamped from the server clock by its touch trigger');

-- --- the sync cursor on github_repos (decision K2) ------------------------------
--
-- Acceptance criterion: both columns exist and are nullable before the first sync — every
-- repository in this database is in exactly that state, because nothing syncs yet.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_repos
    where issues_synced_at is not null or issues_sync_cursor is not null),
  'no repository carries a sync cursor before anything has synced');

-- A cursor is something a sync produced, so it cannot precede one.
select pg_temp.must_reject(
  $$update ouroboros.github_repos set issues_sync_cursor = '2026-08-18T00:00:00Z'
    where id = 'dfff0000-0000-0000-0000-00000000000a'$$,
  'a since watermark cannot exist before the sync that produced it',
  'github_repos_issues_cursor_after_sync');

-- The other direction is legitimate, and is what a first poll of a repository with no
-- issues leaves behind: it looked, and there was nothing to draw a watermark from.
update ouroboros.github_repos set issues_synced_at = now()
  where id = 'dfff0000-0000-0000-0000-00000000000a';

select pg_temp.must_hold(
  (select issues_sync_cursor is null from ouroboros.github_repos
    where id = 'dfff0000-0000-0000-0000-00000000000a'),
  'a repository may have been synced and have no watermark yet');

select pg_temp.must_reject(
  $$update ouroboros.github_repos set issues_sync_cursor = '   '
    where id = 'dfff0000-0000-0000-0000-00000000000a'$$,
  'a blank watermark is refused — it would silently re-import the whole backlog',
  'github_repos_issues_sync_cursor_present');

update ouroboros.github_repos set issues_sync_cursor = '2026-08-18T00:00:00Z'
  where id = 'dfff0000-0000-0000-0000-00000000000a';

select pg_temp.must_hold(
  (select issues_sync_cursor = '2026-08-18T00:00:00Z' from ouroboros.github_repos
    where id = 'dfff0000-0000-0000-0000-00000000000a'),
  'a repository that has synced carries the watermark its next poll sends');

-- --- the indexes the filter bar needs --------------------------------------------
--
-- Acceptance criterion: label containment and title search are index scans under
-- `EXPLAIN`. Sequential scans are off for the reason every other plan assertion in this
-- file gives — a handful of fixture rows is genuinely cheaper to scan, and what is
-- asserted is that a usable index exists at production size.
set local enable_seqscan = off;

select pg_temp.must_use_index(
  $$select number, title from ouroboros.github_issues
     where organization_id = 'org-intake'
       and github_repo_id = 'dfff0000-0000-0000-0000-00000000000a'
       and state = 'open'$$,
  'github_issues_organization_repo_state_idx');

-- The chip-set, both ways it can be read: all-of (containment, which M.1 documents) and
-- any-of (`?|`), which is the operator `jsonb_path_ops` would have silently dropped.
select pg_temp.must_use_index(
  $$select number from ouroboros.github_issues where labels @> '["bug"]'::jsonb$$,
  'github_issues_labels_idx');

select pg_temp.must_use_index(
  $$select number from ouroboros.github_issues where labels ?| array['bug', 'i2c']$$,
  'github_issues_labels_idx');

-- The search box. A substring rather than a prefix, which is the whole reason this index
-- is trigrams and this migration takes an extension.
select pg_temp.must_use_index(
  $$select number from ouroboros.github_issues where title ilike '%watchdog%'$$,
  'github_issues_title_trgm_idx');

-- Not a read path: the cascade's. `github_repos` cascades into this table, and the unique
-- key's leading column is what keeps a repository deletion from scanning every mirrored
-- issue — which is why no separate index on `github_repo_id` was created.
select pg_temp.must_use_index(
  $$select id from ouroboros.github_issues
     where github_repo_id = 'dfff0000-0000-0000-0000-00000000000a'$$,
  'github_issues_repo_number_key');

set local enable_seqscan = on;

-- --- the cascades, in both directions --------------------------------------------
--
-- Deleting a repository takes its mirror with it: a cached copy of a place Ouroboros may
-- no longer look is not history, it is a stale boundary.
delete from ouroboros.github_repos where id = 'dfff0000-0000-0000-0000-00000000000a';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_issues
    where github_repo_id = 'dfff0000-0000-0000-0000-00000000000a'),
  'deleting a github_repo cascades to the issues mirrored from it');

-- And the workspace cascade, end to end — organization → github_orgs → github_repos →
-- github_issues, one statement and every hop.
insert into ouroboros.github_issues
    (organization_id, github_repo_id, number, title, state,
     gh_created_at, gh_updated_at, gh_url)
  values ('org-astray', 'dfff0000-0000-0000-0000-00000000000b', 930, 'Doomed with its org',
          'open', now(), now(), 'https://github.com/astray/astray-firmware/issues/930');

delete from ouroboros.organization where "id" = 'org-astray';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_issues where organization_id = 'org-astray'),
  'deleting an organization cascades through its orgs and repos to its mirrored issues');

-- ===========================================================================
-- V015 — provider_connections and model_aliases, the routing foundation (#189)
-- ===========================================================================
--
-- The pair mockups 07 and 21 will build their management UIs on (decision **M2**), landed
-- here because routing is unbuildable without them. Nothing writes them yet — Z.2 (#195)
-- is the swap menu, Z.3 (#196) is the health service and AD.2 (#223) is what stores a
-- credential — so, as with every read-model section above, every rule a reader depends on
-- is a constraint here rather than an application invariant.
--
-- Three of this ticket's criteria are what most of this section is about, and each is a
-- rule that would be invisible if it were merely intended:
--
--   * **A credential cannot be stored in the clear.** `credentials_encrypted` accepts an
--     `ouro.v1.…` envelope and nothing else, so a plaintext key written by a fixture, a
--     hand-run `update` or a service that forgot to seal is refused by the server. That is
--     the database half of *credentials never appear in logs or responses*; the response
--     half is `ouroboros-rest`'s `registry.integration-spec.ts`, which asks the accessors
--     for a resolution with a real ciphertext in the row and looks for it in the answer.
--   * **`health` cannot lie about a measurement that did not happen** (decision M8).
--     Content requires a `last_checked_at`, a latency is a number, and there is no
--     defaulted `0ms` for a provider nothing has called.
--   * **A connection with dependent aliases cannot be deleted, and a workspace still
--     can.** Both are asserted, because the second is a consequence of trigger ordering
--     that a reader would reasonably doubt.
--
-- Its own fixtures again: the V014 section deleted `org-astray`, and `org-intake` carries
-- no connections. Two fresh workspaces, for the reason the sections above needed two — one
-- to own the aliases, one to own a connection they must not be allowed to name.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-routes',    'Routes Works',    'routes-works',    now()),
  ('org-elsewhere', 'Elsewhere Works', 'elsewhere-works', now());

-- Four of mockup 06's five `.phealth` pills, one per kind that can be told apart, plus the
-- connection in the other workspace that the cross-tenancy assertions aim at.
--
-- The Anthropic row carries a real-shaped envelope rather than a placeholder: the CHECK it
-- has to satisfy is the point of half this section, and a fixture that could not satisfy it
-- would have to be exempted from the rule under test.
insert into ouroboros.provider_connections
    (id, organization_id, kind, display_name, base_url, credentials_encrypted,
     status, last_checked_at, health) values
  ('e0000000-0000-0000-0000-00000000000a', 'org-routes', 'anthropic', 'Anthropic',
   null, 'ouro.v1.1.AAAAAAAAAAAAAAAA.ZmFrZS1jaXBoZXJ0ZXh0LWZvci10ZXN0cw',
   'active', now(), '{"latency_ms": 42}'),
  ('e0000000-0000-0000-0000-00000000000b', 'org-routes', 'copilot', 'GitHub Copilot',
   null, null, 'error', now(), '{"detail": "elevated latency"}'),
  ('e0000000-0000-0000-0000-00000000000c', 'org-routes', 'openai_compatible',
   'OpenAI-compatible', 'http://vllm.local:8000/v1', null, 'active', now(),
   '{"detail": "vLLM local"}'),
  ('e0000000-0000-0000-0000-00000000000d', 'org-routes', 'ollama', 'Ollama',
   'http://workstation.local:11434', null, 'unknown', null, '{}'),
  ('e0000000-0000-0000-0000-00000000000e', 'org-elsewhere', 'anthropic', 'Anthropic',
   null, null, 'unknown', null, '{}');

insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id, params) values
  ('e1000000-0000-0000-0000-00000000000a', 'org-routes', 'coder-max',
   'e0000000-0000-0000-0000-00000000000a', 'claude-fable-5', '{"thinking": "max"}'),
  ('e1000000-0000-0000-0000-00000000000b', 'org-routes', 'coder-fallback',
   'e0000000-0000-0000-0000-00000000000b', 'gpt-4o', '{}'),
  ('e1000000-0000-0000-0000-00000000000c', 'org-routes', 'local-docs',
   'e0000000-0000-0000-0000-00000000000d', 'llama-4-maverick', '{}');

-- --- the migration says what it is, in the database ---------------------------
--
-- Acceptance criterion: *the migration header documents this as the 07/21 shared
-- foundation, naming decision M2*. A header is a comment in a file, and a file can be
-- rewritten by somebody who never read it — so the claim is also carried by the table
-- comments, where it survives into `\d+` and into any tool that reads the catalogue.
-- Asserting it here is what makes the criterion checked rather than reviewed.
select pg_temp.must_hold(
  (select obj_description('ouroboros.provider_connections'::regclass) like '%decision M2%'
      and obj_description('ouroboros.provider_connections'::regclass) like '%mockup 07%'),
  'provider_connections names mockup 07 and decision M2 as what it is a foundation for');

select pg_temp.must_hold(
  (select obj_description('ouroboros.model_aliases'::regclass) like '%M1%'
      and obj_description('ouroboros.model_aliases'::regclass) like '%mockup 21%'),
  'model_aliases names mockup 21 and decision M1 as what it is a foundation for');

-- --- the two vocabularies are closed ------------------------------------------
--
-- Acceptance criterion: *status and kind vocabularies are CHECK-constrained*. Both are
-- text with a check rather than an enum, so widening one later is an ordinary migration —
-- which is exactly why the current width has to be asserted rather than assumed.
select pg_temp.must_reject(
  $$insert into ouroboros.provider_connections (organization_id, kind, display_name)
    values ('org-routes', 'bedrock', 'Amazon Bedrock')$$,
  'a provider kind outside the six is refused', 'provider_connections_kind');

select pg_temp.must_reject(
  $$update ouroboros.provider_connections set status = 'degraded'
    where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'a status outside the four is refused', 'provider_connections_status');

-- All six kinds are reachable, so the CHECK is the vocabulary and not a subset of it. The
-- three not already in the fixtures; `custom` needs no base URL and `cursor` is a cloud
-- kind like `copilot`.
insert into ouroboros.provider_connections (organization_id, kind, display_name) values
  ('org-routes', 'cursor', 'Cursor'),
  ('org-routes', 'custom', 'House LLM');

select pg_temp.must_hold(
  (select count(distinct kind) = 6 from ouroboros.provider_connections
    where organization_id = 'org-routes'),
  'all six provider kinds are representable');

-- --- unknown is the state a connection starts in (decision M8) -----------------
--
-- Not a placeholder and not a default somebody forgot to change: a connection nothing has
-- checked is `unknown`, and `health` is empty, and both are what the strip renders.
select pg_temp.must_hold(
  (select status = 'unknown' and health = '{}'::jsonb and last_checked_at is null
     from ouroboros.provider_connections
    where organization_id = 'org-routes' and display_name = 'House LLM'),
  'a connection nothing has checked is unknown, with no health and no check time');

-- --- health accommodates an absent measurement without lying -------------------
--
-- Acceptance criterion, and the failure it names — *no default 0ms* — is the one that
-- looks like a feature. `0ms` is not "unknown", it is a very good latency.
select pg_temp.must_reject(
  $$update ouroboros.provider_connections set health = '{"latency_ms": 12}'
    where id = 'e0000000-0000-0000-0000-00000000000d'$$,
  'health cannot carry a measurement with no time it was taken',
  'provider_connections_health_measured');

select pg_temp.must_reject(
  $$update ouroboros.provider_connections set health = '{"latency_ms": "42ms"}'
    where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'a latency must be a number, not a string with a unit in it',
  'provider_connections_health_latency');

select pg_temp.must_reject(
  $$update ouroboros.provider_connections set health = '{"latency_ms": null}'
    where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'an explicit JSON null latency is refused — the way to say nothing was measured is to omit the key',
  'provider_connections_health_latency');

select pg_temp.must_reject(
  $$update ouroboros.provider_connections set health = '{"latency_ms": -1}'
    where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'a negative latency is refused', 'provider_connections_health_latency');

select pg_temp.must_reject(
  $$update ouroboros.provider_connections set health = '[]'
    where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'health is an object, so a caller reading a key has something to read',
  'provider_connections_health_object');

-- The legitimate direction: a check that could not connect stamps its time, says so in
-- `status`, and has no latency to report. That row must be representable, or the honesty
-- rule would have made the failure case unstorable.
update ouroboros.provider_connections
   set status = 'error', last_checked_at = now(), health = '{"detail": "connection refused"}'
 where id = 'e0000000-0000-0000-0000-00000000000d';

select pg_temp.must_hold(
  (select health ? 'detail' and not (health ? 'latency_ms')
     from ouroboros.provider_connections
    where id = 'e0000000-0000-0000-0000-00000000000d'),
  'a failed check is storable: a time, a reason, and no latency');

-- Restored, because the assertions below read this row as the unchecked one.
update ouroboros.provider_connections
   set status = 'unknown', health = '{}'::jsonb, last_checked_at = null
 where id = 'e0000000-0000-0000-0000-00000000000d';

-- --- a credential is an envelope or it is nothing ------------------------------
--
-- Acceptance criterion: *credentials never appear in logs or API responses*. This is the
-- half of it the schema can hold — a column that cannot hold a plaintext is one no reader
-- can leak a plaintext out of, whatever it does with the value.
select pg_temp.must_reject(
  $$update ouroboros.provider_connections
       set credentials_encrypted = 'sk-ant-api03-not-a-secret-just-a-shape'
     where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'a plaintext API key cannot be stored in credentials_encrypted',
  'provider_connections_credentials_sealed');

select pg_temp.must_reject(
  $$update ouroboros.provider_connections set credentials_encrypted = ''
     where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'a blank credential is refused rather than read as "configured"',
  'provider_connections_credentials_sealed');

-- A shape that looks like an envelope and is not: the key version has to be a number,
-- because it is what tells a decrypt which key to open the value with.
select pg_temp.must_reject(
  $$update ouroboros.provider_connections
       set credentials_encrypted = 'ouro.v1.latest.AAAA.BBBB'
     where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'an envelope whose key version is not a number is refused',
  'provider_connections_credentials_sealed');

-- And the ordinary state of a local provider: no credential at all, which is legitimate
-- rather than incomplete.
select pg_temp.must_hold(
  (select credentials_encrypted is null from ouroboros.provider_connections
    where id = 'e0000000-0000-0000-0000-00000000000d'),
  'a local provider needs no credential, and null is not a missing value here');

-- --- an address is required exactly where there is no public endpoint ----------
select pg_temp.must_reject(
  $$insert into ouroboros.provider_connections (organization_id, kind, display_name)
    values ('org-routes', 'ollama', 'Nowhere')$$,
  'an ollama connection with no address is refused', 'provider_connections_local_has_base_url');

select pg_temp.must_reject(
  $$insert into ouroboros.provider_connections (organization_id, kind, display_name, base_url)
    values ('org-routes', 'openai_compatible', 'Bad scheme', 'file:///etc/passwd')$$,
  'a base URL must be http or https', 'provider_connections_base_url_present');

select pg_temp.must_reject(
  $$update ouroboros.provider_connections set base_url = '   '
     where id = 'e0000000-0000-0000-0000-00000000000c'$$,
  'a blank base URL is refused rather than read as configured',
  'provider_connections_base_url_present');

-- A private address is deliberately allowed: refusing RFC-1918 would refuse the vLLM and
-- the Ollama the column exists to reach. See docs/SECURITY_MODEL.md § SSRF.
update ouroboros.provider_connections set base_url = 'http://192.168.1.20:11434'
 where id = 'e0000000-0000-0000-0000-00000000000d';

select pg_temp.must_hold(
  (select base_url = 'http://192.168.1.20:11434' from ouroboros.provider_connections
    where id = 'e0000000-0000-0000-0000-00000000000d'),
  'a private address is a legitimate provider address, not an SSRF to be refused here');

-- --- an alias is unique per workspace, and only per workspace ------------------
--
-- Acceptance criterion: *alias uniqueness enforced per organization*.
select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases
      (organization_id, alias, provider_connection_id, model_id)
    values ('org-routes', 'coder-max', 'e0000000-0000-0000-0000-00000000000b', 'gpt-4o')$$,
  'an alias is unique within a workspace', 'model_aliases_organization_alias_key');

insert into ouroboros.model_aliases
    (organization_id, alias, provider_connection_id, model_id)
  values ('org-elsewhere', 'coder-max', 'e0000000-0000-0000-0000-00000000000e', 'claude-opus-5');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.model_aliases where alias = 'coder-max'),
  'two workspaces may each have their own coder-max');

-- The uniqueness is on the stored text, which is why the shape is a rule and not a style:
-- `Coder-Max` beside `coder-max` would be one name with two resolutions.
select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases
      (organization_id, alias, provider_connection_id, model_id)
    values ('org-routes', 'Coder-Max', 'e0000000-0000-0000-0000-00000000000a', 'claude-fable-5')$$,
  'an alias is lower-case, so uniqueness cannot be defeated by capitalisation',
  'model_aliases_alias_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases
      (organization_id, alias, provider_connection_id, model_id)
    values ('org-routes', 'coder max', 'e0000000-0000-0000-0000-00000000000a', 'claude-fable-5')$$,
  'an alias has no spaces — it is a URL segment, a DSL identifier and a CLI argument',
  'model_aliases_alias_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases
      (organization_id, alias, provider_connection_id, model_id)
    values ('org-routes', 'sizer', 'e0000000-0000-0000-0000-00000000000a', '  ')$$,
  'an alias must resolve to a model id that is actually there',
  'model_aliases_model_id_present');

select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases
      (organization_id, alias, provider_connection_id, model_id, params)
    values ('org-routes', 'sizer', 'e0000000-0000-0000-0000-00000000000a', 'claude-sonnet-5',
            '"max thinking"')$$,
  'params is an object, so a caller has something to merge into a request body',
  'model_aliases_params_object');

-- --- an alias may not reach another workspace's connection ---------------------
--
-- Not a broken join: an alias resolving onto another workspace's connection resolves onto
-- that workspace's *credential*. The composite foreign key is what makes this declarative,
-- where V008–V014 needed a trigger — see V015's header.
select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases
      (organization_id, alias, provider_connection_id, model_id)
    values ('org-routes', 'stolen', 'e0000000-0000-0000-0000-00000000000e', 'claude-opus-5')$$,
  'an alias cannot name a connection belonging to another workspace',
  'model_aliases_provider_fk');

select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases
      (organization_id, alias, provider_connection_id, model_id)
    values ('org-routes', 'ghost', '00000000-0000-0000-0000-000000000000', 'claude-opus-5')$$,
  'an alias cannot name a connection that does not exist', 'model_aliases_provider_fk');

-- --- resolution is one indexed query ------------------------------------------
--
-- Acceptance criterion: *alias → provider + model resolution is a single indexed query,
-- verified with EXPLAIN*. Sequential scans are off for the reason every other plan
-- assertion in this file gives — a handful of fixture rows is genuinely cheaper to scan,
-- and what is asserted is that a usable index exists at production size.
--
-- Both halves are checked. `must_use_index` names the entry point, which is the alias's
-- own uniqueness index; `must_not_scan` covers the *other* relation in the same plan,
-- because naming one index says nothing about the table it joins to — and a resolution
-- that scans `provider_connections` is not one query, it is one query and a scan.
--
-- **`analyze` first, and it is load-bearing rather than tidy.** Rows inserted inside this
-- transaction leave the planner with no statistics for them, and on a table of that size
-- the entry point through `(organization_id, alias)` and the one through
-- `(organization_id, provider_connection_id)` cost *exactly the same* — so which one it
-- picks is a tie-break, and a tie-break moves when something unrelated moves. V019 (#579)
-- is what proved that: adding four columns to `model_aliases` flipped this assertion to the
-- foreign key's index — a scan of the workspace's aliases with `alias` as a filter — while
-- changing nothing about either index. With statistics, the difference between one row and
-- N is visible and the unique index wins for the reason it should, which is what makes
-- this an assertion about a plan rather than about an arbitrary choice between two of them.
--
-- It is an `analyze` inside the transaction this file rolls back, so the statistics go with
-- everything else on the way out.
analyze ouroboros.model_aliases;
analyze ouroboros.provider_connections;

set local enable_seqscan = off;

select pg_temp.must_use_index(
  $$select a.model_id, a.params, c.kind, c.base_url, c.status
      from ouroboros.model_aliases a
      join ouroboros.provider_connections c
        on c.organization_id = a.organization_id and c.id = a.provider_connection_id
     where a.organization_id = 'org-routes' and a.alias = 'coder-max'$$,
  'model_aliases_organization_alias_key');

select pg_temp.must_not_scan(
  $$select a.model_id, a.params, c.kind, c.base_url, c.status
      from ouroboros.model_aliases a
      join ouroboros.provider_connections c
        on c.organization_id = a.organization_id and c.id = a.provider_connection_id
     where a.organization_id = 'org-routes' and a.alias = 'coder-max'$$);

-- The swap menu Z.2 (#195) serves: every alias in a workspace with what it resolves to.
select pg_temp.must_not_scan(
  $$select a.alias, a.model_id, c.display_name
      from ouroboros.model_aliases a
      join ouroboros.provider_connections c
        on c.organization_id = a.organization_id and c.id = a.provider_connection_id
     where a.organization_id = 'org-routes'
     order by a.alias$$);

-- The `.phealth` strip: one workspace's connections, entered through the leading column of
-- the composite unique key, which is why no separate index was created for it.
select pg_temp.must_use_index(
  $$select display_name, kind, status, health from ouroboros.provider_connections
     where organization_id = 'org-routes'$$,
  'provider_connections_organization_id_key');

-- Not a read path: the foreign key's. PostgreSQL indexes the referenced side of a foreign
-- key and never the referencing side, so without this every connection delete — and every
-- workspace delete, which cascades into one — would scan this table.
select pg_temp.must_use_index(
  $$select alias from ouroboros.model_aliases
     where organization_id = 'org-routes'
       and provider_connection_id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'model_aliases_provider_idx');

set local enable_seqscan = on;

-- --- updated_at is the server's account, not the writer's ----------------------
update ouroboros.provider_connections set updated_at = timestamptz '2000-01-01 00:00:00Z'
 where id = 'e0000000-0000-0000-0000-00000000000a';

select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.provider_connections
    where id = 'e0000000-0000-0000-0000-00000000000a'),
  'provider_connections.updated_at is stamped from the server clock by its touch trigger');

update ouroboros.model_aliases set updated_at = timestamptz '2000-01-01 00:00:00Z'
 where id = 'e1000000-0000-0000-0000-00000000000a';

select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.model_aliases
    where id = 'e1000000-0000-0000-0000-00000000000a'),
  'model_aliases.updated_at is stamped from the server clock by its touch trigger');

-- --- a connection an alias depends on cannot be deleted ------------------------
--
-- Acceptance criterion: *deleting a provider that has dependent aliases is blocked (FK
-- restrict)*. The alternative — a cascade — would delete the *aliases*, which are what
-- Y.2's routes point at, so a provider removed in mockup 07 would silently empty routes
-- drawn in mockup 06.
select pg_temp.must_reject(
  $$delete from ouroboros.provider_connections
     where id = 'e0000000-0000-0000-0000-00000000000a'$$,
  'a connection with dependent aliases cannot be deleted', 'model_aliases_provider_fk');

-- The list a designed refusal has to name — *"coder-max depends on this connection"* — is
-- one indexed read, which is the second job model_aliases_provider_idx does.
select pg_temp.must_hold(
  (select array_agg(alias order by alias) = array['coder-max']
     from ouroboros.model_aliases
    where organization_id = 'org-routes'
      and provider_connection_id = 'e0000000-0000-0000-0000-00000000000a'),
  'the aliases blocking a delete are nameable, which is what makes the refusal designed');

-- And the way through it: remove what depends on it first. The refusal is a sequencing
-- rule, not a permanent one.
delete from ouroboros.model_aliases where id = 'e1000000-0000-0000-0000-00000000000a';
delete from ouroboros.provider_connections where id = 'e0000000-0000-0000-0000-00000000000a';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.provider_connections
    where id = 'e0000000-0000-0000-0000-00000000000a'),
  'a connection whose aliases are gone deletes normally');

-- --- the workspace cascade, which the restrict must not block ------------------
--
-- The interaction V015's header writes down, asserted rather than argued: both tables
-- cascade from `organization`, and the restrict above is checked immediately — so the
-- obvious fear is that the connection cascade meets aliases that have not been deleted
-- yet and refuses, making a workspace undeletable the moment it configured a provider.
--
-- It does not, because both cascades are queued as after-triggers of the same statement
-- and run before the referential check the connection delete appends. This assertion is
-- what would fail if that ever stopped being true.
select pg_temp.must_hold(
  (select count(*) > 0 from ouroboros.model_aliases where organization_id = 'org-routes')
   and (select count(*) > 0 from ouroboros.provider_connections where organization_id = 'org-routes'),
  'the workspace about to be deleted really does have both connections and aliases');

delete from ouroboros.organization where "id" = 'org-routes';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.provider_connections where organization_id = 'org-routes')
   and (select count(*) = 0 from ouroboros.model_aliases where organization_id = 'org-routes'),
  'deleting a workspace takes its connections and aliases with it, restrict notwithstanding');

-- ===========================================================================
-- V016 — task_kinds, routes and route_hops, the routing matrix (#190)
-- ===========================================================================
--
-- The matrix row of mockup 06 as relations: one task kind, exactly one route, an ordered
-- chain of hops and a policy triple. Nothing writes them yet — Z.2 (#195) is the editor and
-- Y.4 (#192) is the seed — so, as with every read-model section above, every rule a reader
-- depends on is a constraint here rather than an application invariant.
--
-- Four of this ticket's criteria are what most of this section is about:
--
--   * **Ordering is enforceable, not conventional.** Hop positions are unique *and* dense
--     from 1, and the reorder the mockup's `drag ⠿` hint promises is exercised in both the
--     forms it really takes — a one-statement swap and a two-statement move — with both
--     properties re-asserted afterwards. That matters because `floor_hop_index` is a rule
--     about a hop *number*: a chain that numbers itself 1, 2, 5 makes *"fallback 2"* mean
--     nothing, and the page's promise never to degrade below the floor unkeepable.
--   * **Deferred is not unenforced.** Both ordering rules defer to `commit` so a reorder
--     needs no ceremony, and every probe below asks for the check early with
--     `set constraints … immediate` rather than trusting that a rule checked later is a
--     rule checked at all.
--   * **A raw provider model id cannot reach a route** (decision M1). Asserted from
--     `information_schema` rather than by reading the migration: the only column in these
--     three tables with `model` in its name is the uuid foreign key.
--   * **An alias a hop names cannot be deleted, and the routes in the way are nameable.**
--     Both halves, because a refusal that cannot say *which* route it protected is not a
--     designed one.
--
-- Its own fixtures again, and two workspaces for the reason every section above needed two:
-- one to own the matrix, one to own the alias it must not be allowed to reach.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-matrix',    'Matrix Works',    'matrix-works',    now()),
  ('org-neighbour', 'Neighbour Works', 'neighbour-works', now());

insert into ouroboros."user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values
  ('user-router', 'Rou Ter', 'rou@matrix-works.dev', true, now(), now());

-- One connection per workspace, and the three aliases the inspector's chain is drawn from.
insert into ouroboros.provider_connections (id, organization_id, kind, display_name) values
  ('e6000000-0000-0000-0000-00000000000a', 'org-matrix',    'anthropic', 'Anthropic'),
  ('e6000000-0000-0000-0000-00000000000e', 'org-neighbour', 'anthropic', 'Anthropic');

insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id) values
  ('e7000000-0000-0000-0000-00000000000a', 'org-matrix', 'coder-max',
   'e6000000-0000-0000-0000-00000000000a', 'claude-fable-5'),
  ('e7000000-0000-0000-0000-00000000000b', 'org-matrix', 'coder-fallback',
   'e6000000-0000-0000-0000-00000000000a', 'gpt-5-codex'),
  ('e7000000-0000-0000-0000-00000000000c', 'org-matrix', 'local-docs',
   'e6000000-0000-0000-0000-00000000000a', 'qwen3-coder:32b'),
  ('e7000000-0000-0000-0000-00000000000e', 'org-neighbour', 'coder-max',
   'e6000000-0000-0000-0000-00000000000e', 'claude-opus-5');

-- Three of the mockup's eight rows, in its order, with the tags it prints — `testgen-primary`
-- rather than `test-gen-primary`, which is why `tag` is a column and not a derivation.
insert into ouroboros.task_kinds (id, organization_id, name, description, sort_order) values
  ('e8000000-0000-0000-0000-000000000004', 'org-matrix', 'implement',
   'Write the change, run tests, iterate to green', 4),
  ('e8000000-0000-0000-0000-000000000005', 'org-matrix', 'test-gen',
   'Generate unit and regression tests for the diff', 5),
  ('e8000000-0000-0000-0000-000000000007', 'org-matrix', 'docs',
   'Update READMEs, changelogs, operator manual', 7);

insert into ouroboros.routes
    (id, organization_id, task_kind_id, tag, allow_local_fallback, floor_hop_index,
     max_cost_cents_per_run, updated_by) values
  ('e9000000-0000-0000-0000-000000000004', 'org-matrix', 'e8000000-0000-0000-0000-000000000004',
   'implement-primary', true, null, 250, 'user-router'),
  ('e9000000-0000-0000-0000-000000000005', 'org-matrix', 'e8000000-0000-0000-0000-000000000005',
   'testgen-primary', true, null, null, null),
  ('e9000000-0000-0000-0000-000000000007', 'org-matrix', 'e8000000-0000-0000-0000-000000000007',
   'docs-primary', true, null, null, null);

-- The inspector's chain, verbatim: three hops, their aliases and their hop-meta lines.
insert into ouroboros.route_hops
    (id, organization_id, route_id, position, model_alias_id, note) values
  ('ea000000-0000-0000-0000-000000000001', 'org-matrix', 'e9000000-0000-0000-0000-000000000004',
   1, 'e7000000-0000-0000-0000-00000000000a', 'Primary'),
  ('ea000000-0000-0000-0000-000000000002', 'org-matrix', 'e9000000-0000-0000-0000-000000000004',
   2, 'e7000000-0000-0000-0000-00000000000b', 'Fallback on 5xx / timeouts'),
  ('ea000000-0000-0000-0000-000000000003', 'org-matrix', 'e9000000-0000-0000-0000-000000000004',
   3, 'e7000000-0000-0000-0000-00000000000c', 'Offline mode — keeps the loop turning without a network'),
  ('ea000000-0000-0000-0000-000000000005', 'org-matrix', 'e9000000-0000-0000-0000-000000000005',
   1, 'e7000000-0000-0000-0000-00000000000b', null),
  ('ea000000-0000-0000-0000-000000000007', 'org-matrix', 'e9000000-0000-0000-0000-000000000007',
   1, 'e7000000-0000-0000-0000-00000000000c', null);

-- --- a raw provider model id cannot reach a route (decision M1) ----------------
--
-- Acceptance criterion: *no column anywhere in these three tables can hold a raw provider
-- model id*. V015 could only state M1, because the rule is about tables it did not create;
-- this is where it becomes structural, and the check is a catalogue read rather than a
-- reading of the migration — a `model` column added by a later migration is caught here
-- rather than noticed in review.
select pg_temp.must_hold(
  (select array_agg(table_name || '.' || column_name order by table_name, column_name)
          = array['route_hops.model_alias_id']
     from information_schema.columns
    where table_schema = 'ouroboros'
      and table_name in ('task_kinds', 'routes', 'route_hops')
      and column_name like '%model%'),
  'the only model-ish column in the routing tables is the alias foreign key');

select pg_temp.must_hold(
  (select data_type = 'uuid' from information_schema.columns
    where table_schema = 'ouroboros' and table_name = 'route_hops'
      and column_name = 'model_alias_id'),
  'a hop names an alias by id, so there is nothing for a model string to be stored in');

-- And the same claim carried into the catalogue, where it survives a rewritten file: the
-- table comments say what these tables are, so `\d+` and any tool that reads a description
-- gets the rule with the schema.
select pg_temp.must_hold(
  (select obj_description('ouroboros.route_hops'::regclass) like '%M1%'
      and obj_description('ouroboros.task_kinds'::regclass) like '%M3%'
      and obj_description('ouroboros.routes'::regclass) like '%M4%'),
  'each routing table names the decision it implements');

-- --- task kinds are registry data, per workspace (decision M3) -----------------
select pg_temp.must_reject(
  $$insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
    values ('org-matrix', 'implement', 'A second implement', 20)$$,
  'a task kind name is unique within a workspace', 'task_kinds_organization_name_key');

insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
  values ('org-neighbour', 'implement', 'Write the change, run tests, iterate to green', 1);

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.task_kinds where name = 'implement'),
  'two workspaces may each have their own implement');

-- The shape is a correctness rule for the reason V015 gave `alias`: uniqueness is enforced
-- on the stored text, so `Implement` beside `implement` would be one name with two routes.
select pg_temp.must_reject(
  $$insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
    values ('org-matrix', 'Implement', 'Capitalised', 21)$$,
  'a task kind is lower-case, so uniqueness cannot be defeated by capitalisation',
  'task_kinds_name_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
    values ('org-matrix', 'commit msg', 'With a space', 22)$$,
  'a task kind has no spaces — it is a DSL identifier and a stage-catalog key',
  'task_kinds_name_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
    values ('org-matrix', 'triage', '   ', 23)$$,
  'a task kind carries the matrix line that tells it from its neighbour',
  'task_kinds_description_present');

select pg_temp.must_reject(
  $$insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
    values ('org-matrix', 'triage', 'Zeroth row', 0)$$,
  'the top of the matrix is row 1, not row 0', 'task_kinds_sort_order_positive');

-- --- the matrix is reorderable ------------------------------------------------
--
-- Acceptance criterion: *task-kind name is unique per organization and sort_order is
-- reorderable*. Deferred, so the swap is plain SQL — the same arrangement V009 gave
-- `queue_items.position`, and deliberately without the density rule the hops below carry:
-- nothing reads these numbers, and the matrix renders 1, 2, 5 exactly as it renders 1, 2, 3.
update ouroboros.task_kinds
   set sort_order = case sort_order when 5 then 7 when 7 then 5 end
 where organization_id = 'org-matrix' and sort_order in (5, 7);

select pg_temp.must_hold(
  (select array_agg(name order by sort_order) = array['implement', 'docs', 'test-gen']
     from ouroboros.task_kinds where organization_id = 'org-matrix'),
  'a one-statement matrix reorder succeeds inside a transaction');

update ouroboros.task_kinds
   set sort_order = case sort_order when 5 then 7 when 7 then 5 end
 where organization_id = 'org-matrix' and sort_order in (5, 7);

-- Deferred is not unenforced: asked for early, a duplicate row order does not survive.
select pg_temp.must_reject(
  $$insert into ouroboros.task_kinds (organization_id, name, description, sort_order)
    values ('org-matrix', 'triage', 'Two rows in one place', 4);
    set constraints ouroboros.task_kinds_organization_sort_order_key immediate$$,
  'two task kinds cannot share a matrix row in one workspace',
  'task_kinds_organization_sort_order_key');

select pg_temp.must_hold(
  (select condeferrable and condeferred from pg_constraint
    where conrelid = 'ouroboros.task_kinds'::regclass
      and conname = 'task_kinds_organization_sort_order_key'),
  'the matrix order key is deferrable and initially deferred, which is what makes a drag plain SQL');

-- The natural key is the opposite, deliberately: a duplicate name is a thing a person can
-- ask for and must be told about at the statement — and Y.4 needs it as an upsert arbiter,
-- which a deferrable index cannot be.
select pg_temp.must_hold(
  (select not condeferrable from pg_constraint
    where conrelid = 'ouroboros.task_kinds'::regclass
      and conname = 'task_kinds_organization_name_key'),
  'the task kind name key is immediate, and therefore usable as an on-conflict arbiter');

-- --- exactly one route per task kind ------------------------------------------
--
-- Acceptance criterion: *one active route per task kind is enforced by constraint, not by
-- application code*. Resolution (Z.1) asks for **the** route of a kind, and a second row
-- would make that question have two answers, silently and differently per query plan.
select pg_temp.must_reject(
  $$insert into ouroboros.routes (organization_id, task_kind_id, tag)
    values ('org-matrix', 'e8000000-0000-0000-0000-000000000004', 'implement-second')$$,
  'a task kind has exactly one route', 'routes_task_kind_key');

-- And there is no `is_active` column beside it to make "one active route" a partial rule —
-- a superseded revision belongs in a history table, where it cannot be mistaken for a route
-- that is merely switched off.
select pg_temp.must_hold(
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'ouroboros' and table_name = 'routes'
      and column_name in ('is_active', 'active', 'enabled')),
  'one route per kind is the constraint, not a flag a writer has to remember to set');

-- A fourth kind, deliberately without a route: the two probes below aim at rules that a
-- kind which already had one would never reach, because `routes_task_kind_key` would fire
-- first and the assertion would pass for the wrong reason.
insert into ouroboros.task_kinds (id, organization_id, name, description, sort_order) values
  ('e8000000-0000-0000-0000-000000000009', 'org-matrix', 'review',
   'Self-review the PR against the acceptance criteria', 9);

select pg_temp.must_reject(
  $$insert into ouroboros.routes (organization_id, task_kind_id, tag)
    values ('org-matrix', 'e8000000-0000-0000-0000-000000000009', 'docs-primary')$$,
  'a route tag is unique within a workspace, because it is how a person names one',
  'routes_organization_tag_key');

select pg_temp.must_reject(
  $$update ouroboros.routes set tag = 'Implement Primary'
     where id = 'e9000000-0000-0000-0000-000000000004'$$,
  'a route tag is lower-case kebab, like every other name a URL and a log line carry',
  'routes_tag_shape');

-- --- the route may not reach another workspace's task kind --------------------
select pg_temp.must_reject(
  $$insert into ouroboros.routes (organization_id, task_kind_id, tag)
    values ('org-matrix', (select id from ouroboros.task_kinds
                            where organization_id = 'org-neighbour' and name = 'implement'),
            'stolen-primary')$$,
  'a route cannot answer for another workspace''s task kind', 'routes_task_kind_fk');

-- A kind with no route is an ordinary state — the matrix draws the row, and its primary
-- model column is what has not been chosen yet. It is a route with no *chain* that is
-- refused, not a kind with no route.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.routes
    where task_kind_id = 'e8000000-0000-0000-0000-000000000009'),
  'a task kind may exist before anybody has routed it');

-- --- money is integer cents ---------------------------------------------------
--
-- Acceptance criterion: *max_cost_cents_per_run is integer cents; no floating-point currency
-- anywhere*. Asserted from the catalogue rather than from the migration, because the failure
-- this prevents is a later `alter … type numeric` that no fixture would notice.
select pg_temp.must_hold(
  (select data_type = 'integer' from information_schema.columns
    where table_schema = 'ouroboros' and table_name = 'routes'
      and column_name = 'max_cost_cents_per_run'),
  'a cost cap is an integer count of cents, never a float');

select pg_temp.must_hold(
  (select max_cost_cents_per_run = 250 from ouroboros.routes
    where id = 'e9000000-0000-0000-0000-000000000004'),
  'the inspector''s $2.50 is stored as 250 cents');

select pg_temp.must_reject(
  $$update ouroboros.routes set max_cost_cents_per_run = 0
     where id = 'e9000000-0000-0000-0000-000000000004'$$,
  'a cap of zero is not a cap, it is a route that can never run',
  'routes_max_cost_positive');

select pg_temp.must_hold(
  (select max_cost_cents_per_run is null from ouroboros.routes
    where id = 'e9000000-0000-0000-0000-000000000005'),
  'null is how "no cap" is said, and it is an ordinary state');

-- --- the floor points at a hop that exists ------------------------------------
--
-- Acceptance criterion: *floor_hop_index is validated to be ≤ the chain length (and
-- null-permitting)*. Half of it is a CHECK — the chain starts at hop 1, so a floor below it
-- is not a floor — and half of it cannot be, because the chain's length lives in another
-- table and changes when a *hop* is written. That half is the deferred constraint trigger.
select pg_temp.must_reject(
  $$update ouroboros.routes set floor_hop_index = 0
     where id = 'e9000000-0000-0000-0000-000000000004'$$,
  'there is no hop 0 for a floor to sit on', 'routes_floor_hop_index_positive');

select pg_temp.must_reject(
  $$update ouroboros.routes set floor_hop_index = 9
     where id = 'e9000000-0000-0000-0000-000000000004';
    set constraints ouroboros.routes_chain_intact immediate$$,
  'a floor past the end of the chain can never fire, so it is refused rather than stored',
  'routes_chain_intact');

-- The mockup's own setting: *"fail run instead of degrading below fallback 2"* is hop 3 of a
-- three-hop chain, which is legal exactly because it is not past the end.
update ouroboros.routes set floor_hop_index = 3
 where id = 'e9000000-0000-0000-0000-000000000004';

select pg_temp.must_hold(
  (select floor_hop_index = 3 from ouroboros.routes
    where id = 'e9000000-0000-0000-0000-000000000004'),
  'a floor at the last hop of the chain is the mockup''s setting, and it is legal');

-- The other direction, which is the one a chain edit walks into: shortening the chain under
-- a floor that was valid a moment ago is the same violation seen from the hops.
select pg_temp.must_reject(
  $$delete from ouroboros.route_hops
     where id = 'ea000000-0000-0000-0000-000000000003';
    set constraints ouroboros.route_hops_chain_intact immediate$$,
  'a hop cannot be removed out from under a floor that counts it',
  'route_hops_chain_intact');

update ouroboros.routes set floor_hop_index = null
 where id = 'e9000000-0000-0000-0000-000000000004';

select pg_temp.must_hold(
  (select floor_hop_index is null from ouroboros.routes
    where id = 'e9000000-0000-0000-0000-000000000004'),
  'null is a floor that was never set, and the chain is free to degrade to its end');

-- --- the chain is ordered, and the order is total -----------------------------
--
-- Acceptance criterion, first half: *hop positions are unique per route*.
select pg_temp.must_reject(
  $$update ouroboros.route_hops set position = 1
     where id = 'ea000000-0000-0000-0000-000000000002';
    set constraints ouroboros.route_hops_route_position_key immediate$$,
  'two hops cannot claim the same place in one chain',
  'route_hops_route_position_key');

select pg_temp.must_reject(
  $$update ouroboros.route_hops set position = 0
     where id = 'ea000000-0000-0000-0000-000000000001'$$,
  'the primary is hop 1, and there is no hop 0 to shuffle through',
  'route_hops_position_positive');

-- Position uniqueness is per chain and only per chain: every route has a hop 1.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.route_hops
    where organization_id = 'org-matrix' and position = 1),
  'position uniqueness is per route, not per workspace');

select pg_temp.must_hold(
  (select condeferrable and condeferred from pg_constraint
    where conrelid = 'ouroboros.route_hops'::regclass
      and conname = 'route_hops_route_position_key'),
  'the hop position key is deferrable and initially deferred, which is what makes a drag plain SQL');

-- --- the chain is dense, and a reorder keeps it that way -----------------------
--
-- Acceptance criterion, and the one the ticket asks to see performed: *a transactional
-- reorder (swap hops 2 ↔ 3) is verified to preserve both properties*. Both forms a reorder
-- really takes are exercised, because they fail differently under an immediate constraint:
-- the one-statement `case` collides mid-statement, and the two-statement move collides
-- between statements.
update ouroboros.route_hops
   set position = case position when 2 then 3 when 3 then 2 end
 where route_id = 'e9000000-0000-0000-0000-000000000004' and position in (2, 3);

select pg_temp.must_hold(
  (select array_agg(id order by position)
          = array['ea000000-0000-0000-0000-000000000001',
                  'ea000000-0000-0000-0000-000000000003',
                  'ea000000-0000-0000-0000-000000000002']::uuid[]
     from ouroboros.route_hops where route_id = 'e9000000-0000-0000-0000-000000000004'),
  'a one-statement swap of hops 2 and 3 succeeds inside a transaction');

-- The two-statement form, moving one hop at a time — and back to the mockup's order.
update ouroboros.route_hops set position = 3
  where id = 'ea000000-0000-0000-0000-000000000003';
update ouroboros.route_hops set position = 2
  where id = 'ea000000-0000-0000-0000-000000000002';

select pg_temp.must_hold(
  (select array_agg(position order by position) = array[1, 2, 3]
     from ouroboros.route_hops where route_id = 'e9000000-0000-0000-0000-000000000004'),
  'the reorder left the chain unique and dense from 1, which is what the floor rule counts');

select pg_temp.must_hold(
  (select array_agg(a.alias order by h.position)
          = array['coder-max', 'coder-fallback', 'local-docs']
     from ouroboros.route_hops h
     join ouroboros.model_aliases a
       on a.organization_id = h.organization_id and a.id = h.model_alias_id
    where h.route_id = 'e9000000-0000-0000-0000-000000000004'),
  'and it is the inspector''s chain again, in the mockup''s order');

-- Acceptance criterion, second half: *positions are dense per route*. A gap is what a naive
-- delete leaves behind, and it is what makes "fallback 2" ambiguous.
select pg_temp.must_reject(
  $$delete from ouroboros.route_hops
     where id = 'ea000000-0000-0000-0000-000000000002';
    set constraints ouroboros.route_hops_chain_intact immediate$$,
  'removing a hop from the middle of a chain leaves a gap, and a gap is refused',
  'route_hops_chain_intact');

select pg_temp.must_reject(
  $$insert into ouroboros.route_hops (organization_id, route_id, position, model_alias_id)
    values ('org-matrix', 'e9000000-0000-0000-0000-000000000004', 5,
            'e7000000-0000-0000-0000-00000000000a');
    set constraints ouroboros.route_hops_chain_intact immediate$$,
  'a hop cannot be appended past the end of the chain', 'route_hops_chain_intact');

-- A route with no chain is a matrix row with no primary model — which resolution cannot
-- answer and the inspector cannot draw.
select pg_temp.must_reject(
  $$delete from ouroboros.route_hops
     where route_id = 'e9000000-0000-0000-0000-000000000007';
    set constraints ouroboros.route_hops_chain_intact immediate$$,
  'a route is its chain, so emptying one is refused', 'route_hops_chain_intact');

select pg_temp.must_reject(
  $$insert into ouroboros.task_kinds (id, organization_id, name, description, sort_order)
    values ('e8000000-0000-0000-0000-000000000008', 'org-matrix', 'commit-msg',
            'Conventional-commit message from the staged diff', 8);
    insert into ouroboros.routes (organization_id, task_kind_id, tag)
    values ('org-matrix', 'e8000000-0000-0000-0000-000000000008', 'commitmsg-primary');
    set constraints ouroboros.routes_chain_intact immediate$$,
  'a route created with no hops is refused at the end of its own transaction',
  'routes_chain_intact');

-- The legitimate whole-chain rewrite, which is what "save routes" really does: empty the
-- chain and lay a new one down, all inside one transaction where nothing is checked until
-- it ends. This is the shape the deferral exists for.
delete from ouroboros.route_hops
 where route_id = 'e9000000-0000-0000-0000-000000000005';
insert into ouroboros.route_hops (organization_id, route_id, position, model_alias_id, note) values
  ('org-matrix', 'e9000000-0000-0000-0000-000000000005', 1,
   'e7000000-0000-0000-0000-00000000000a', 'Primary'),
  ('org-matrix', 'e9000000-0000-0000-0000-000000000005', 2,
   'e7000000-0000-0000-0000-00000000000b', null);

select pg_temp.must_hold(
  (select array_agg(position order by position) = array[1, 2]
     from ouroboros.route_hops where route_id = 'e9000000-0000-0000-0000-000000000005'),
  'a whole chain can be replaced in one transaction, which is what saving a route does');

-- Moving a hop to another chain is checked on **both** sides, which is the case a
-- forward-looking rule would miss: the chain it left is the one with the gap in it.
select pg_temp.must_reject(
  $$update ouroboros.route_hops set route_id = 'e9000000-0000-0000-0000-000000000007'
     where id = 'ea000000-0000-0000-0000-000000000002';
    set constraints ouroboros.route_hops_chain_intact immediate$$,
  'moving a hop out of a chain is refused by the chain it left, not only by the one it joined',
  'route_hops_chain_intact');

-- --- a hop may not reach another workspace's alias -----------------------------
--
-- Not a broken join: a hop resolving onto another workspace's alias resolves onto that
-- workspace's model *and* the credential behind it. The composite foreign key is what makes
-- this declarative, and V015's `(organization_id, id)` key — declared by this migration — is
-- what makes it possible at all.
select pg_temp.must_reject(
  $$insert into ouroboros.route_hops (organization_id, route_id, position, model_alias_id)
    values ('org-matrix', 'e9000000-0000-0000-0000-000000000007', 2,
            'e7000000-0000-0000-0000-00000000000e')$$,
  'a hop cannot name an alias belonging to another workspace', 'route_hops_alias_fk');

select pg_temp.must_reject(
  $$insert into ouroboros.route_hops (organization_id, route_id, position, model_alias_id)
    values ('org-matrix', 'e9000000-0000-0000-0000-000000000007', 2,
            '00000000-0000-0000-0000-000000000000')$$,
  'a hop cannot name an alias that does not exist', 'route_hops_alias_fk');

select pg_temp.must_reject(
  $$insert into ouroboros.route_hops (organization_id, route_id, position, model_alias_id)
    values ('org-neighbour', 'e9000000-0000-0000-0000-000000000007', 2,
            'e7000000-0000-0000-0000-00000000000e')$$,
  'a hop cannot join a chain belonging to another workspace', 'route_hops_route_fk');

-- --- the hop-meta line ---------------------------------------------------------
select pg_temp.must_hold(
  (select note = 'Fallback on 5xx / timeouts' from ouroboros.route_hops
    where id = 'ea000000-0000-0000-0000-000000000002'),
  'the inspector''s hop-meta line is stored beside the hop it explains');

select pg_temp.must_reject(
  $$update ouroboros.route_hops set note = '   '
     where id = 'ea000000-0000-0000-0000-000000000001'$$,
  'a blank note is refused rather than rendered as an empty explanation',
  'route_hops_note_present');

select pg_temp.must_hold(
  (select note is null from ouroboros.route_hops
    where id = 'ea000000-0000-0000-0000-000000000007'),
  'most hops need no explanation, and null is how that is said');

-- --- the routing reads are indexed ---------------------------------------------
--
-- Sequential scans are off for the reason every other plan assertion in this file gives — a
-- handful of fixture rows is genuinely cheaper to scan, and what is asserted is that a
-- usable index exists at production size. `must_not_scan` covers every relation in a plan,
-- which is what a join needs: naming one index says nothing about the table it joins to.
set local enable_seqscan = off;

-- The matrix: a workspace's task kinds in row order, each with its route.
select pg_temp.must_not_scan(
  $$select tk.name, tk.description, r.tag, r.max_cost_cents_per_run
      from ouroboros.task_kinds tk
      join ouroboros.routes r
        on r.organization_id = tk.organization_id and r.task_kind_id = tk.id
     where tk.organization_id = 'org-matrix'
     order by tk.sort_order$$);

-- The inspector: one route's chain in order, resolved through the registry. Every hop is a
-- join to `model_aliases`, which is what M1 costs and what its `(organization_id, id)` key
-- pays for.
select pg_temp.must_use_index(
  $$select h.position, a.alias, a.model_id, h.note
      from ouroboros.route_hops h
      join ouroboros.model_aliases a
        on a.organization_id = h.organization_id and a.id = h.model_alias_id
     where h.route_id = 'e9000000-0000-0000-0000-000000000004'
     order by h.position$$,
  'route_hops_route_position_key');

select pg_temp.must_not_scan(
  $$select h.position, a.alias, a.model_id, h.note
      from ouroboros.route_hops h
      join ouroboros.model_aliases a
        on a.organization_id = h.organization_id and a.id = h.model_alias_id
     where h.route_id = 'e9000000-0000-0000-0000-000000000004'
     order by h.position$$);

-- The catalog read WF-R.3 (#145) is served through Z.4: a workspace's task-kind names.
select pg_temp.must_not_scan(
  $$select name, description from ouroboros.task_kinds
     where organization_id = 'org-matrix' order by name$$);

-- And the lookup the DSL's `route.task("implement")` validates through — one kind by the
-- name somebody wrote down — which is what the natural key is really for.
select pg_temp.must_use_index(
  $$select id, description from ouroboros.task_kinds
     where organization_id = 'org-matrix' and name = 'implement'$$,
  'task_kinds_organization_name_key');

-- A route by the tag a person quoted.
select pg_temp.must_use_index(
  $$select id from ouroboros.routes
     where organization_id = 'org-matrix' and tag = 'implement-primary'$$,
  'routes_organization_tag_key');

-- Not a read path: the foreign key's. PostgreSQL indexes the referenced side and never the
-- referencing one, so without this every alias delete — and every workspace delete, which
-- cascades into one — would scan the hops.
select pg_temp.must_use_index(
  $$select id from ouroboros.route_hops
     where organization_id = 'org-matrix'
       and model_alias_id = 'e7000000-0000-0000-0000-00000000000a'$$,
  'route_hops_alias_idx');

-- The other foreign key's referencing side — which hops does this route have, asked by every
-- route delete and by every cascade into one. It has no index of its own: the position key
-- leads on the route and the alias index leads on the workspace, so the pair is covered
-- whichever the planner reaches for, which is what this asserts rather than naming one.
select pg_temp.must_not_scan(
  $$select id from ouroboros.route_hops
     where organization_id = 'org-matrix'
       and route_id = 'e9000000-0000-0000-0000-000000000004'$$);

-- And the same index's second job: the list a designed refusal has to name.
select pg_temp.must_not_scan(
  $$select distinct r.tag
      from ouroboros.route_hops h
      join ouroboros.routes r
        on r.organization_id = h.organization_id and r.id = h.route_id
     where h.organization_id = 'org-matrix'
       and h.model_alias_id = 'e7000000-0000-0000-0000-00000000000a'$$);

set local enable_seqscan = on;

-- --- updated_at is the server's account, not the writer's ----------------------
update ouroboros.task_kinds set updated_at = timestamptz '2000-01-01 00:00:00Z'
 where id = 'e8000000-0000-0000-0000-000000000004';
update ouroboros.routes set updated_at = timestamptz '2000-01-01 00:00:00Z'
 where id = 'e9000000-0000-0000-0000-000000000004';
update ouroboros.route_hops set updated_at = timestamptz '2000-01-01 00:00:00Z'
 where id = 'ea000000-0000-0000-0000-000000000001';

select pg_temp.must_hold(
  (select (select updated_at = now() from ouroboros.task_kinds
            where id = 'e8000000-0000-0000-0000-000000000004')
      and (select updated_at = now() from ouroboros.routes
            where id = 'e9000000-0000-0000-0000-000000000004')
      and (select updated_at = now() from ouroboros.route_hops
            where id = 'ea000000-0000-0000-0000-000000000001')),
  'all three routing tables stamp updated_at from the server clock by their touch triggers');

-- --- who saved the route, and what happens when they leave ---------------------
--
-- V011's rule, third table: deleting the person who last saved a route must not delete the
-- route. What is genuinely lost is the attribution, not the routing.
select pg_temp.must_hold(
  (select updated_by = 'user-router' from ouroboros.routes
    where id = 'e9000000-0000-0000-0000-000000000004'),
  'a saved route records who saved it');

delete from ouroboros."user" where "id" = 'user-router';

select pg_temp.must_hold(
  (select updated_by is null from ouroboros.routes
    where id = 'e9000000-0000-0000-0000-000000000004'),
  'deleting the person who last saved a route empties the attribution and keeps the route');

-- --- an alias a hop names cannot be deleted -----------------------------------
--
-- Acceptance criterion: *deleting a model_alias referenced by any hop is blocked with a
-- designed error naming the affected route*. A cascade here would silently *shorten* chains
-- — hop 2 removed from every route that named the alias, the remaining hops left at 1 and 3
-- — and the first anybody would know of it is a run that degraded past a floor which no
-- longer counts the hops it was written against.
select pg_temp.must_reject(
  $$delete from ouroboros.model_aliases
     where id = 'e7000000-0000-0000-0000-00000000000b'$$,
  'an alias that a chain names cannot be retired out from under it', 'route_hops_alias_fk');

-- The other half of "designed": the refusal can say **which** routes it protected. This is
-- the read the index above serves, and it is what mockup 21's delete confirmation is built
-- from.
select pg_temp.must_hold(
  (select array_agg(distinct r.tag order by r.tag)
          = array['implement-primary', 'testgen-primary']
     from ouroboros.route_hops h
     join ouroboros.routes r
       on r.organization_id = h.organization_id and r.id = h.route_id
    where h.organization_id = 'org-matrix'
      and h.model_alias_id = 'e7000000-0000-0000-0000-00000000000b'),
  'the routes blocking an alias delete are nameable, which is what makes the refusal designed');

-- And the way through it: take the alias out of the chains first. The refusal is a
-- sequencing rule, not a permanent one — and taking a hop out means renumbering what is
-- left, which is the density rule doing its job rather than obstructing it.
delete from ouroboros.route_hops
 where organization_id = 'org-matrix'
   and model_alias_id = 'e7000000-0000-0000-0000-00000000000b';
update ouroboros.route_hops set position = 2
 where id = 'ea000000-0000-0000-0000-000000000003';
delete from ouroboros.model_aliases where id = 'e7000000-0000-0000-0000-00000000000b';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_aliases
    where id = 'e7000000-0000-0000-0000-00000000000b'),
  'an alias no chain names deletes normally');

-- --- the workspace cascade, which the restrict must not block ------------------
--
-- V015's interaction, asserted again for the wider graph this migration adds: the routing
-- tables cascade from `organization` and the alias restrict is checked immediately, so the
-- obvious fear is that a workspace becomes undeletable the moment it drew a route. It does
-- not, because the cascades are queued as after-triggers of the same statement and run
-- before the referential check the alias delete appends.
select pg_temp.must_hold(
  (select count(*) > 0 from ouroboros.task_kinds  where organization_id = 'org-matrix')
   and (select count(*) > 0 from ouroboros.routes     where organization_id = 'org-matrix')
   and (select count(*) > 0 from ouroboros.route_hops where organization_id = 'org-matrix'),
  'the workspace about to be deleted really does have a matrix, routes and chains');

delete from ouroboros.organization where "id" = 'org-matrix';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.task_kinds  where organization_id = 'org-matrix')
   and (select count(*) = 0 from ouroboros.routes     where organization_id = 'org-matrix')
   and (select count(*) = 0 from ouroboros.route_hops where organization_id = 'org-matrix')
   and (select count(*) = 0 from ouroboros.model_aliases where organization_id = 'org-matrix'),
  'deleting a workspace takes its matrix, routes, chains and aliases with it, restrict notwithstanding');

-- And the narrower cascade underneath it: retiring a task kind takes its route, and the
-- route takes its chain. A hop outliving the route it was part of is not a chain.
insert into ouroboros.task_kinds (id, organization_id, name, description, sort_order) values
  ('e8000000-0000-0000-0000-00000000000f', 'org-neighbour', 'review',
   'Self-review the PR against the acceptance criteria', 2);
insert into ouroboros.routes (id, organization_id, task_kind_id, tag) values
  ('e9000000-0000-0000-0000-00000000000f', 'org-neighbour',
   'e8000000-0000-0000-0000-00000000000f', 'review-primary');
insert into ouroboros.route_hops (organization_id, route_id, position, model_alias_id) values
  ('org-neighbour', 'e9000000-0000-0000-0000-00000000000f', 1,
   'e7000000-0000-0000-0000-00000000000e');

delete from ouroboros.task_kinds where id = 'e8000000-0000-0000-0000-00000000000f';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.routes
    where id = 'e9000000-0000-0000-0000-00000000000f')
   and (select count(*) = 0 from ouroboros.route_hops
         where route_id = 'e9000000-0000-0000-0000-00000000000f'),
  'retiring a task kind takes its route, and the route takes its chain');

-- ===========================================================================
-- V017 — what the provider cards show, the discovered catalog, and soft validation (#221)
-- ===========================================================================
--
-- AC.6 extends V015 rather than forking it, so this section extends V015's above rather
-- than restating it: the rules asserted here are the five columns mockup 07's cards read,
-- `provider_models`, and the alias warning that is deliberately not a foreign key.
--
-- Four of the ticket's criteria are what most of it is about:
--
--   * **`enabled` and `status` are independently settable, and the card distinguishes
--     them.** All four combinations are inserted, because a schema that had quietly
--     collapsed the switch into the health vocabulary would still be green everywhere else.
--   * **`(provider_connection_id, model_id)` uniqueness holds, and re-running discovery
--     upserts rather than duplicating.** Both halves: the constraint refuses the second
--     row, and the upsert statement AE.4 will issue refreshes the first one in place.
--   * **The alias-to-unknown-model warning fires and does not block the write.** The row is
--     read back after the statement that warned about it, which is the only half of "warns"
--     that SQL can observe: nothing in plpgsql can catch a warning. The message is asserted
--     by the `ci/db` step that greps this suite's transcript for both of the states it
--     tells apart, and the predicate underneath it is asserted here in both directions.
--   * **A cap cannot be negative**, which is the rule the meter's arithmetic rests on.
--
-- Its own fixtures again, in a workspace of their own — the sections above have deleted
-- theirs, and a card fixture that shared a workspace with V015's would make the cascade
-- assertions at the foot ambiguous.
--
-- One consequence of the warning reaches back through the whole file, and is worth knowing
-- before reading a transcript: **every alias the V015 and V016 sections create now warns**,
-- because those fixtures name models nothing has discovered on their connections. That is
-- the rule doing exactly what it is for — it is soft, so those sections still pass — and it
-- is why the `ci/db` grep looks for the *mismatch* branch, which only the fixture below
-- produces.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-cards', 'Cards Works', 'cards-works', now());

insert into ouroboros."user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values
  ('user-adder', 'Ada Adder', 'ada@cards-works.dev', true, now(), now());

-- Three of mockup 07's five cards, chosen for what they differ in: a capped cloud provider
-- with a credential and a catalog, an uncapped local one, and a connection nothing has
-- discovered anything on. The fourth row is the *switched off* card, which no mockup draws
-- and every card component has to be able to.
insert into ouroboros.provider_connections
    (id, organization_id, kind, display_name, base_url, status, last_checked_at, health,
     monthly_cap_cents, added_by, last_used_at, capability_note, enabled) values
  ('eb000000-0000-0000-0000-00000000000a', 'org-cards', 'anthropic', 'Anthropic Claude',
   null, 'active', now(), '{"latency_ms": 38}', 60000, 'user-adder',
   now() - interval '3 minutes', 'api.anthropic.com · primary coding lane', true),
  ('eb000000-0000-0000-0000-00000000000b', 'org-cards', 'ollama', 'Ollama · workstation',
   'http://workstation.local:11434', 'active', now(), '{"latency_ms": 4}', null,
   'user-adder', now() - interval '41 seconds',
   'zero-cost lane — used for docs & commit messages', true),
  ('eb000000-0000-0000-0000-00000000000c', 'org-cards', 'copilot', 'GitHub Copilot',
   null, 'error', now(), '{"detail": "503 upstream · retrying"}', 9500, 'user-adder',
   now() - interval '72 minutes', 'billed through GitHub org acme-robotics', true),
  ('eb000000-0000-0000-0000-00000000000d', 'org-cards', 'cursor', 'Cursor',
   null, 'active', now(), '{"latency_ms": 51}', 0, 'user-adder', null,
   'switched off while the trial is decided', false);

-- Anthropic's four chips, and the workstation's three pull-list lines with their sizes.
insert into ouroboros.provider_models
    (id, provider_connection_id, model_id, display, size_bytes, meta) values
  ('ec000000-0000-0000-0000-00000000000a', 'eb000000-0000-0000-0000-00000000000a',
   'claude-fable-5', 'claude-fable-5', null, '{"context_tokens": 1000000, "tier": "priority"}'),
  ('ec000000-0000-0000-0000-00000000000b', 'eb000000-0000-0000-0000-00000000000a',
   'claude-haiku-4-5', 'claude-haiku-4-5', null, '{"context_tokens": 200000}'),
  ('ec000000-0000-0000-0000-00000000000c', 'eb000000-0000-0000-0000-00000000000b',
   'qwen3-coder:32b', 'qwen3-coder:32b', 19000000000, '{}'),
  ('ec000000-0000-0000-0000-00000000000d', 'eb000000-0000-0000-0000-00000000000b',
   'llama4:scout', 'llama4:scout', 63000000000, '{}');

-- --- the migration says what it is, in the database ---------------------------
--
-- The same reasoning V015's section gives: a header is a comment in a file, and the claim
-- that survives into `\d+` and into any tool that reads the catalogue is the comment on the
-- object. P6 is the decision this table exists for, so the table has to name it.
select pg_temp.must_hold(
  (select obj_description('ouroboros.provider_models'::regclass) like '%decision P6%'
      and obj_description('ouroboros.provider_models'::regclass) like '%discovery%'),
  'provider_models names decision P6 and discovery as what it is for');

select pg_temp.must_hold(
  (select col_description('ouroboros.provider_connections'::regclass,
                          (select attnum from pg_attribute
                            where attrelid = 'ouroboros.provider_connections'::regclass
                              and attname = 'enabled')) like '%NOT the health status%'),
  'the enabled column says in the catalogue that it is not the health status');

-- --- a freshly added connection renders honestly -------------------------------
--
-- Every column AC.6 adds is nullable but one, and the one exception defaults to *on*. That
-- is the state a connection the add-form (AE.5) has just stored is in, and each of the five
-- values is something a card draws: no cap is the mockup's em-dash, no `last_used_at` is
-- *never used*, and no note is a card with one line instead of two.
insert into ouroboros.provider_connections (id, organization_id, kind, display_name) values
  ('eb000000-0000-0000-0000-00000000000e', 'org-cards', 'custom', 'Freshly Added');

select pg_temp.must_hold(
  (select enabled
      and monthly_cap_cents is null
      and added_by is null
      and last_used_at is null
      and capability_note is null
     from ouroboros.provider_connections
    where id = 'eb000000-0000-0000-0000-00000000000e'),
  'a connection added with nothing extra is enabled, uncapped, unattributed and never used');

-- --- the switch is not the health, and the card has to draw both ---------------
--
-- Acceptance criterion: *`enabled` and health `status` are independently settable*. All
-- four combinations, written as four updates of one row rather than four rows, so what is
-- asserted is that neither column moves the other — the failure a trigger or a collapsed
-- vocabulary would produce.
update ouroboros.provider_connections
   set enabled = false, status = 'active'
 where id = 'eb000000-0000-0000-0000-00000000000e';
select pg_temp.must_hold(
  (select not enabled and status = 'active'
     from ouroboros.provider_connections
    where id = 'eb000000-0000-0000-0000-00000000000e'),
  'a connection may be switched off while its last health check still says active');

update ouroboros.provider_connections
   set enabled = true, status = 'error'
 where id = 'eb000000-0000-0000-0000-00000000000e';
select pg_temp.must_hold(
  (select enabled and status = 'error'
     from ouroboros.provider_connections
    where id = 'eb000000-0000-0000-0000-00000000000e'),
  'and may be left switched on while the provider is failing, which is the card the mockup draws');

update ouroboros.provider_connections
   set enabled = false, status = 'error'
 where id = 'eb000000-0000-0000-0000-00000000000e';

-- All four, across the workspace's rows: Anthropic on and healthy, Copilot on and failing,
-- Cursor off while its last check succeeded, and this one off and failing. A schema that
-- had collapsed the switch into the health vocabulary could not produce four.
select pg_temp.must_hold(
  (select count(*) = 4 from (
     select distinct enabled, status
       from ouroboros.provider_connections
      where organization_id = 'org-cards'
        and status in ('active', 'error')
   ) as combinations),
  'both switch positions occur against both health outcomes, which is four cards to draw');

-- The switch has two positions and no third. A nullable one would be a card that can
-- render neither on nor off, which is the state a boolean exists to rule out.
select pg_temp.must_reject(
  $$update ouroboros.provider_connections set enabled = null
     where id = 'eb000000-0000-0000-0000-00000000000e'$$,
  'the enable switch has no third state');

-- --- the cap is money, and money has a floor -----------------------------------
--
-- Acceptance criterion, and the rule the meter rests on: a negative cap renders a meter
-- already past 100% for a workspace that has spent nothing. Zero is admitted deliberately —
-- *spend nothing* is a real instruction, and V017's header says why it is not the same as
-- no cap at all.
select pg_temp.must_reject(
  $$update ouroboros.provider_connections set monthly_cap_cents = -1
     where id = 'eb000000-0000-0000-0000-00000000000a'$$,
  'a negative monthly cap is refused', 'provider_connections_monthly_cap_nonnegative');

select pg_temp.must_hold(
  (select monthly_cap_cents = 0 from ouroboros.provider_connections
    where id = 'eb000000-0000-0000-0000-00000000000d'),
  'a cap of zero is a cap — spend nothing — and is stored as one');

select pg_temp.must_hold(
  (select monthly_cap_cents is null from ouroboros.provider_connections
    where id = 'eb000000-0000-0000-0000-00000000000b'),
  'a local provider carries no cap at all, which is the em-dash the mockup renders');

-- --- the capability line is a line, or it is absent ----------------------------
select pg_temp.must_reject(
  $$update ouroboros.provider_connections set capability_note = '   '
     where id = 'eb000000-0000-0000-0000-00000000000a'$$,
  'a blank capability line is refused rather than rendered as an empty second row',
  'provider_connections_capability_note_present');

select pg_temp.must_reject(
  $$update ouroboros.provider_connections set capability_note = repeat('x', 161)
     where id = 'eb000000-0000-0000-0000-00000000000a'$$,
  'a capability line longer than the card can hold is refused',
  'provider_connections_capability_note_present');

-- --- who added it, and what happens when they leave ----------------------------
--
-- Acceptance criterion for the meta row, and the pair of rules underneath it: the
-- attribution has to name somebody who exists, and losing them must not lose the provider.
select pg_temp.must_reject(
  $$update ouroboros.provider_connections set added_by = 'nobody-at-all'
     where id = 'eb000000-0000-0000-0000-00000000000a'$$,
  'a connection cannot be attributed to a person who does not exist',
  'provider_connections_added_by_fk');

delete from ouroboros."user" where "id" = 'user-adder';

select pg_temp.must_hold(
  (select count(*) = 5 and count(*) filter (where added_by is null) = 5
     from ouroboros.provider_connections
    where organization_id = 'org-cards'),
  'deleting the person who added the providers keeps every one of them, unattributed');

-- --- the catalog is unique per connection, and shared across them ---------------
--
-- Acceptance criterion: *(provider_connection_id, model_id) uniqueness holds*. The second
-- half is the one worth stating — the same model id on a *different* connection is two
-- rows, because two workspaces (or two Ollama daemons) offering `qwen3-coder:32b` are two
-- separate facts about two separate providers.
select pg_temp.must_reject(
  $$insert into ouroboros.provider_models (provider_connection_id, model_id, display)
    values ('eb000000-0000-0000-0000-00000000000a', 'claude-fable-5', 'Claude Fable 5')$$,
  'one connection cannot list the same model twice',
  'provider_models_connection_model_key');

insert into ouroboros.provider_models (provider_connection_id, model_id, display) values
  ('eb000000-0000-0000-0000-00000000000c', 'claude-fable-5', 'copilot/claude-fable-5');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.provider_models
    where model_id = 'claude-fable-5'),
  'the same model id on two connections is two rows, because it is two facts');

-- --- re-running discovery refreshes rather than duplicates ----------------------
--
-- Acceptance criterion, asserted with the statement AE.4 (#230) will actually issue: the
-- upsert V017's header documents. What makes it work is the unique key above, so this is
-- the same rule read from the other side — and the size and the stamp have to move, because
-- a second pass over a model that has been re-pulled is exactly when they change.
insert into ouroboros.provider_models
     (provider_connection_id, model_id, display, size_bytes, meta, discovered_at)
values ('eb000000-0000-0000-0000-00000000000b', 'qwen3-coder:32b', 'qwen3-coder:32b',
        20100000000, '{"context_tokens": 262144}', now())
    on conflict (provider_connection_id, model_id) do update
       set display       = excluded.display,
           size_bytes    = excluded.size_bytes,
           meta          = excluded.meta,
           discovered_at = excluded.discovered_at;

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.provider_models
    where provider_connection_id = 'eb000000-0000-0000-0000-00000000000b'
      and model_id = 'qwen3-coder:32b'
      and size_bytes = 20100000000
      and meta = '{"context_tokens": 262144}'::jsonb),
  'discovery run twice leaves one row, carrying the second run''s size and metadata');

-- --- a size is a size, and metadata is an object --------------------------------
select pg_temp.must_reject(
  $$update ouroboros.provider_models set size_bytes = -1
     where id = 'ec000000-0000-0000-0000-00000000000c'$$,
  'a negative model size is refused', 'provider_models_size_bytes_positive');

select pg_temp.must_reject(
  $$update ouroboros.provider_models set size_bytes = 0
     where id = 'ec000000-0000-0000-0000-00000000000c'$$,
  'a zero model size is refused — the way to say "no size" is null, not a tag claiming none',
  'provider_models_size_bytes_positive');

select pg_temp.must_hold(
  (select size_bytes is null from ouroboros.provider_models
    where id = 'ec000000-0000-0000-0000-00000000000a'),
  'a cloud model carries no size at all, which is what the card renders no tag for');

select pg_temp.must_reject(
  $$update ouroboros.provider_models set meta = '[]'
     where id = 'ec000000-0000-0000-0000-00000000000a'$$,
  'discovery metadata must be an object a caller can merge', 'provider_models_meta_object');

select pg_temp.must_reject(
  $$insert into ouroboros.provider_models (provider_connection_id, model_id, display)
    values ('eb000000-0000-0000-0000-00000000000a', 'claude-opus-5', '  ')$$,
  'a chip with no text is refused', 'provider_models_display_present');

-- --- the catalog has no workspace of its own ------------------------------------
--
-- V017's one deliberate departure from this schema's tenancy habit, asserted as a
-- catalogue read rather than left in the header: a `organization_id` added here later would
-- be a second copy of a fact the connection already carries, and this is what notices.
select pg_temp.must_hold(
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'ouroboros'
      and table_name = 'provider_models'
      and column_name in ('organization_id', 'tenant_id')),
  'provider_models carries no workspace id: its tenancy is the connection it hangs off');

-- --- listing a connection's models, and deleting one, reach an index -------------
--
-- The unique key is doing three jobs — the rule, the read, and the referencing side of the
-- foreign key — which is why V017 adds no index of its own. If that ever stopped being
-- true, the delete below would start scanning the catalog.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select model_id from ouroboros.provider_models
     where provider_connection_id = 'eb000000-0000-0000-0000-00000000000a'$$,
  'provider_models_connection_model_key');
set local enable_seqscan = on;

-- --- soft validation: the warning fires, and the row is written ------------------
--
-- Acceptance criterion: *the alias-to-unknown-model warning fires on a fixture and does not
-- block the write*. The predicate is asserted in both directions first, because it is what
-- the trigger consults and what mockup 21's discovery-mismatch state will read; then the
-- alias that trips it is inserted and read back.
select pg_temp.must_hold(
  ouroboros.provider_model_discovered('eb000000-0000-0000-0000-00000000000a', 'claude-fable-5'),
  'a model discovery reported on that connection is known to the predicate');

select pg_temp.must_hold(
  not ouroboros.provider_model_discovered('eb000000-0000-0000-0000-00000000000a', 'claude-fable-6'),
  'a model it did not report is not — and a near-miss spelling is the ordinary way that happens');

select pg_temp.must_hold(
  not ouroboros.provider_model_discovered('eb000000-0000-0000-0000-00000000000e', 'anything-at-all'),
  'nor is anything at all on a connection nothing has been discovered on');

-- The gap branch — a connection with no catalog — and the mismatch branch, on a connection
-- that has one. Both warn; the transcript is where the message is read, and `ci/db` greps
-- it. What is asserted here is the half that is not a message: the rows exist.
insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id) values
  ('ed000000-0000-0000-0000-00000000000a', 'org-cards', 'coder-max',
   'eb000000-0000-0000-0000-00000000000a', 'claude-fable-5'),
  ('ed000000-0000-0000-0000-00000000000b', 'org-cards', 'coder-ghost',
   'eb000000-0000-0000-0000-00000000000a', 'claude-fable-6'),
  ('ed000000-0000-0000-0000-00000000000c', 'org-cards', 'undiscovered-lane',
   'eb000000-0000-0000-0000-00000000000e', 'anything-at-all');

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.model_aliases where organization_id = 'org-cards'),
  'an alias naming a model discovery has not reported is written, warning and all — soft in MVP by P6');

select pg_temp.must_hold(
  (select model_id = 'claude-fable-6' from ouroboros.model_aliases
    where id = 'ed000000-0000-0000-0000-00000000000b'),
  'and it is stored exactly as it was written, so the mismatch is visible rather than corrected');

-- Repointing an alias at a model that *is* in the catalog is the fix, and it passes through
-- the same trigger without a word.
update ouroboros.model_aliases set model_id = 'claude-haiku-4-5'
 where id = 'ed000000-0000-0000-0000-00000000000b';

select pg_temp.must_hold(
  ouroboros.provider_model_discovered(
    (select provider_connection_id from ouroboros.model_aliases
      where id = 'ed000000-0000-0000-0000-00000000000b'),
    (select model_id from ouroboros.model_aliases
      where id = 'ed000000-0000-0000-0000-00000000000b')),
  'repointing the alias at a discovered model is what clears the mismatch');

-- --- the trigger watches the two columns that can create a mismatch --------------
--
-- `before insert or update of provider_connection_id, model_id`, read from the catalogue.
-- Without the column list, pinning a temperature — an update of `params` alone — would
-- re-warn about a model nobody touched, and a warning that fires on writes it has nothing
-- to say about is a warning people learn to ignore.
select pg_temp.must_hold(
  (select array_agg(att.attname::text order by att.attname) = array['model_id', 'provider_connection_id']
     from pg_trigger trg
     cross join lateral unnest(trg.tgattr) as columns (attnum)
     join pg_attribute att
       on att.attrelid = trg.tgrelid and att.attnum = columns.attnum
    where trg.tgrelid = 'ouroboros.model_aliases'::regclass
      and trg.tgname = 'model_aliases_warn_undiscovered_model'),
  'the warning watches provider_connection_id and model_id, and nothing else');

-- --- the catalog goes when its connection does, and both go with the workspace ----
delete from ouroboros.provider_connections
 where id = 'eb000000-0000-0000-0000-00000000000c';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.provider_models
    where provider_connection_id = 'eb000000-0000-0000-0000-00000000000c'),
  'deleting a connection takes its discovered catalog with it');

select pg_temp.must_hold(
  (select count(*) > 0 from ouroboros.provider_models pm
     join ouroboros.provider_connections c on c.id = pm.provider_connection_id
    where c.organization_id = 'org-cards'),
  'the workspace about to be deleted really does still have a catalog');

delete from ouroboros.organization where "id" = 'org-cards';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.provider_connections where organization_id = 'org-cards')
   and (select count(*) = 0 from ouroboros.model_aliases where organization_id = 'org-cards')
   and (select count(*) = 0 from ouroboros.provider_models pm
         where pm.id::text like 'ec000000%'),
  'deleting the workspace takes its connections, its aliases and every discovered model with them');

-- ===========================================================================
-- V018 — escalation_rules, the card's three sentences as structure (#191)
-- ===========================================================================
--
-- Mockup 06's *ESCALATION RULES* card is the one place on the page where the cheap
-- implementation is obvious and wrong: the three lines read like sentences, so storing them
-- as sentences looks like the whole job — and then nothing can evaluate them. Decision M5
-- takes the other path, and this section is where that becomes checkable rather than
-- claimed.
--
-- The ticket's six criteria are what it is about:
--
--   * **The three mockup rules round-trip without loss.** Written as structure, read back as
--     structure, and their derived sentences compared to the mockup **character for
--     character** — which is the only comparison that means anything for a string a card
--     prints verbatim.
--   * **A malformed `"then"` cannot be stored, and is refused by a CHECK by name.** Unknown
--     action keys, two actions at once, and every shape underneath each action.
--   * **`"when"` is WF-P8's grammar scoped to routing, not a parallel one.** Asserted twice
--     over: an unknown condition key is refused, and every effort size `queue_items_effort`
--     names — read out of the catalogue rather than restated here — is a size a rule may
--     name. Two closed vocabularies of five values are one vocabulary only for as long as
--     nobody edits one of them.
--   * **The sentence is derived, deterministically, and cannot be hand-written.** The
--     column is `generated always … stored`, which is asserted from the catalogue and
--     proved by watching PostgreSQL refuse a supplied value; the same structure renders the
--     same sentence in a second workspace; and it renders in the *grammar's* key order even
--     though jsonb stores those keys in another.
--   * **A rule naming a task kind or an alias the workspace does not have is refused at
--     write time.** Both directions — writing such a rule, and retiring the kind or alias a
--     rule already names — because a reference held in only one direction is a reference
--     that goes stale the first time somebody tidies up.
--   * **`sort_order` is a deterministic evaluation order**, unique per workspace and
--     reorderable, with the deferral proved not to mean unenforced.
--
-- Its own fixtures, and two workspaces again: one to own the rules, one to own the alias
-- they must not be allowed to reach.

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-rules',     'Rules Works',     'rules-works',     now()),
  ('org-bystander', 'Bystander Works', 'bystander-works', now());

insert into ouroboros.provider_connections (id, organization_id, kind, display_name) values
  ('ee000000-0000-0000-0000-00000000000a', 'org-rules',     'anthropic', 'Anthropic'),
  ('ee000000-0000-0000-0000-00000000000b', 'org-bystander', 'anthropic', 'Anthropic');

-- `coder-max` in both workspaces, and one alias each workspace has alone: the pair is what
-- makes the tenancy assertion below mean something.
insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id) values
  ('ef000000-0000-0000-0000-00000000000a', 'org-rules', 'coder-max',
   'ee000000-0000-0000-0000-00000000000a', 'claude-fable-5'),
  ('ef000000-0000-0000-0000-00000000000b', 'org-rules', 'second-opinion',
   'ee000000-0000-0000-0000-00000000000a', 'composer-2'),
  ('ef000000-0000-0000-0000-00000000000c', 'org-bystander', 'coder-max',
   'ee000000-0000-0000-0000-00000000000b', 'claude-opus-5'),
  ('ef000000-0000-0000-0000-00000000000d', 'org-bystander', 'bystander-only',
   'ee000000-0000-0000-0000-00000000000b', 'claude-opus-5');

insert into ouroboros.task_kinds (organization_id, name, description, sort_order) values
  ('org-rules', 'implement', 'Write the change, run tests, iterate to green',      4),
  ('org-rules', 'review',    'Self-review the PR against the acceptance criteria', 6),
  ('org-bystander', 'plan',  'Decompose into steps, pick a workflow',              1);

-- --- the three mockup rules, as structure -------------------------------------
--
-- Acceptance criterion: *all three serialize and round-trip through the schema without
-- loss*. The literals below are the ticket's fixture table, and nothing but `id`,
-- `enabled`, `sort_order` and the timestamps is supplied — `display` cannot be.
insert into ouroboros.escalation_rules (id, organization_id, sort_order, "when", "then") values
  ('f0000000-0000-0000-0000-000000000001', 'org-rules', 1,
   '{"effort_gte": "l"}',
   '{"use_alias": {"task_kind": "implement", "alias": "coder-max", "params": {"thinking": "max"}}}'),
  ('f0000000-0000-0000-0000-000000000002', 'org-rules', 2,
   '{"label": "security"}',
   '{"add_vote": {"task_kind": "review", "alias": "second-opinion"}}'),
  ('f0000000-0000-0000-0000-000000000003', 'org-rules', 3,
   '{"diff_kind": "docs_only"}',
   '{"route_local": {}}');

-- The card's `3 active`, and the order it draws them in.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.escalation_rules
    where organization_id = 'org-rules' and enabled),
  'the workspace has the mockup''s three rules and all three are active');

-- The sentences, character for character. This is the ticket's round-trip table, and it is
-- the assertion the whole migration exists to make true.
select pg_temp.must_hold(
  (select array_agg(display order by sort_order) = array[
     'effort ≥ L → implement uses coder-max (max thinking)',
     'security label → review adds second-opinion vote',
     'docs-only diff → everything routes local']
     from ouroboros.escalation_rules where organization_id = 'org-rules'),
  'the three mockup rules render the three sentences mockup 06 prints, exactly');

-- And the structure came back unchanged — a round-trip is both halves, and a schema that
-- had quietly normalised `params` away would still render the first sentence from what it
-- kept.
select pg_temp.must_hold(
  (select "when" = '{"effort_gte": "l"}'::jsonb
      and "then" = '{"use_alias": {"task_kind": "implement", "alias": "coder-max", "params": {"thinking": "max"}}}'::jsonb
     from ouroboros.escalation_rules where id = 'f0000000-0000-0000-0000-000000000001'),
  'the rule reads back as the structure it was written as, params and all');

-- The mockup's *"(max thinking)"* is data rather than prose, which is what makes it
-- mergeable over `model_aliases.params` by resolution (Z.1) instead of parseable.
select pg_temp.must_hold(
  (select "then" #> '{use_alias,params}' = '{"thinking": "max"}'::jsonb
     from ouroboros.escalation_rules where id = 'f0000000-0000-0000-0000-000000000001'),
  'the parenthesis in the mockup''s first rule is a params object, not a phrase');

-- --- the sentence is derived, and cannot be written ---------------------------
--
-- Acceptance criterion: *display strings regenerate deterministically from structure* and
-- hand-written text is rejected. The first half is a property of the column, read from the
-- catalogue so that a later migration turning it into an ordinary text column is caught
-- here rather than noticed when the two copies first disagree.
select pg_temp.must_hold(
  (select attgenerated = 's' from pg_attribute
    where attrelid = 'ouroboros.escalation_rules'::regclass and attname = 'display'),
  'display is a stored generated column, which is what makes the sentence underivable by hand');

-- The refusal itself, which is PostgreSQL's rather than a trigger's — class 42, not 23, so
-- it is asserted with must_raise rather than must_reject.
select pg_temp.must_raise(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then", display)
    values ('org-rules', 9, '{"effort_gte": "l"}', '{"route_local": {}}',
            'effort ≥ L → everything is fine, honestly')$$,
  '428C9',
  'a hand-written display is refused by the column itself, whoever the writer is');

-- Deterministic across workspaces: the same structure is the same sentence, because the
-- derivation reads the two documents and nothing else.
insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then") values
  ('org-bystander', 1, '{"diff_kind": "docs_only"}', '{"route_local": {}}');

select pg_temp.must_hold(
  (select count(distinct display) = 1 from ouroboros.escalation_rules
    where "then" = '{"route_local": {}}'::jsonb),
  'the same rule renders the same sentence in a second workspace');

-- And in the *grammar's* key order rather than the document's. jsonb orders an object's
-- keys by length — so this rule stores `label` before `effort_gte` — and the sentence
-- nevertheless leads with the effort, which is what makes it a function of the rule rather
-- than of how somebody typed it.
select pg_temp.must_hold(
  (select array_agg(k) = array['label', 'effort_gte']
     from jsonb_object_keys('{"effort_gte": "l", "label": "security"}'::jsonb) k),
  'jsonb really does store these two keys in the other order');

select pg_temp.must_hold(
  ouroboros.escalation_rule_display(
    '{"effort_gte": "l", "label": "security"}', '{"route_local": {}}')
  = 'effort ≥ L and security label → everything routes local',
  'a two-condition rule reads in the grammar''s order, and its clauses are ANDed');

-- Editing the structure re-derives the sentence: an edited rule cannot keep the one it had.
update ouroboros.escalation_rules
   set "then" = '{"use_alias": {"task_kind": "implement", "alias": "coder-max"}}'
 where id = 'f0000000-0000-0000-0000-000000000001';

select pg_temp.must_hold(
  (select display = 'effort ≥ L → implement uses coder-max'
     from ouroboros.escalation_rules where id = 'f0000000-0000-0000-0000-000000000001'),
  'dropping the params re-derives the sentence without the parenthesis');

update ouroboros.escalation_rules
   set "then" = '{"use_alias": {"task_kind": "implement", "alias": "coder-max", "params": {"thinking": "max"}}}'
 where id = 'f0000000-0000-0000-0000-000000000001';

select pg_temp.must_hold(
  (select display = 'effort ≥ L → implement uses coder-max (max thinking)'
     from ouroboros.escalation_rules where id = 'f0000000-0000-0000-0000-000000000001'),
  'and putting them back restores it, which is what "regenerates from structure" means');

-- Several params render in sorted key order, value before key, comma-joined — the one rule
-- rather than a table of phrasings.
select pg_temp.must_hold(
  ouroboros.escalation_rule_display(
    '{"effort_gte": "xl"}',
    '{"use_alias": {"task_kind": "plan", "alias": "coder-max",
                    "params": {"thinking": "max", "temperature": 0.2}}}')
  = 'effort ≥ XL → plan uses coder-max (0.2 temperature, max thinking)',
  'two params render sorted, value before key, in one parenthesis');

-- --- the "then" shapes, and nothing else --------------------------------------
--
-- Acceptance criterion: *malformed `then` shapes are rejected by CHECK constraint — an
-- unknown action key cannot be stored*. It is a domain constraint, so the refusal arrives at
-- the value rather than at the row, which is what lets the derivation above be written for
-- structures already known good.
select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}', '{"delete_the_repository": {}}')$$,
  'an action key outside the three cannot be stored', 'escalation_rule_then_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"route_local": {}, "add_vote": {"task_kind": "review", "alias": "second-opinion"}}')$$,
  'a rule carries exactly one action, because two would depend on which a reader saw first',
  'escalation_rule_then_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}', '"route_local"')$$,
  'an action is an object under an action key, not a bare string',
  'escalation_rule_then_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}', '{"route_local": {"except": ["docs"]}}')$$,
  'route_local takes no options today, and an unrecognised one is refused rather than ignored',
  'escalation_rule_then_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"use_alias": {"task_kind": "implement"}}')$$,
  'use_alias names both a task kind and the alias it swaps in', 'escalation_rule_then_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"add_vote": {"task_kind": "review", "alias": "second-opinion",
                           "params": {"thinking": "max"}}}')$$,
  'only use_alias carries params — a vote has no invocation defaults to merge',
  'escalation_rule_then_shape');

-- The names are shaped as the tables that hold them shape theirs, so a rule cannot name
-- something `task_kinds` or `model_aliases` could never contain. `Coder-Max` is V015's
-- example of why that shape is a correctness rule rather than a style one.
select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"use_alias": {"task_kind": "implement", "alias": "Coder-Max"}}')$$,
  'an alias in a rule is lower-case kebab, exactly as model_aliases.alias is',
  'escalation_rule_then_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"use_alias": {"task_kind": "implement", "alias": "coder-max", "params": {}}}')$$,
  'an empty params object would render as an empty parenthesis; absence is how "none" is said',
  'escalation_rule_then_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"use_alias": {"task_kind": "implement", "alias": "coder-max",
                            "params": {"thinking": {"budget": "max"}}}}')$$,
  'a params value is a scalar, because every one of them is rendered into the sentence',
  'escalation_rule_then_shape');

-- --- the "when" grammar is WF-P8's, scoped -------------------------------------
--
-- Acceptance criterion: *`when` predicates conform to the WF-P8 grammar (shared vocabulary,
-- not a parallel one)*. `source` is one of WF's own trigger conditions and is deliberately
-- the probe: routing has no such context, so a rule carrying it would be a rule nothing
-- evaluates, stored as though it would be.
select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"source": "github"}', '{"route_local": {}}')$$,
  'a condition key routing has no context for is refused rather than ignored',
  'escalation_rule_when_grammar');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{}', '{"route_local": {}}')$$,
  'a rule with no condition always fires, which is a route rather than an escalation',
  'escalation_rule_when_grammar');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "xxl"}', '{"route_local": {}}')$$,
  'a sixth effort size is refused here exactly as it is on the queue',
  'escalation_rule_when_grammar');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"label": "  "}', '{"route_local": {}}')$$,
  'a blank label is not a label', 'escalation_rule_when_grammar');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"label": ["security", "urgent"]}', '{"route_local": {}}')$$,
  'a label condition names one label; an array is a shape the derivation cannot render',
  'escalation_rule_when_grammar');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"diff_kind": "tests_only"}', '{"route_local": {}}')$$,
  'a diff classification nothing computes is a rule that can never fire',
  'escalation_rule_when_grammar');

-- One vocabulary, not two that currently agree. The five sizes are read out of
-- `queue_items_effort` rather than restated here, so widening one of the two without the
-- other is what goes red — which is the whole content of "shared vocabulary".
select pg_temp.must_hold(
  (select count(*) = 5 and bool_and(ouroboros.escalation_rule_when_valid(
                                      jsonb_build_object('effort_gte', size)))
     from (select (regexp_matches(pg_get_constraintdef(oid), '''([a-z]+)''::text', 'g'))[1] as size
             from pg_constraint where conname = 'queue_items_effort') sizes),
  'every effort size the queue accepts is one an escalation rule may name — five, and the same five');

-- --- a rule cannot name what the workspace does not have -----------------------
--
-- Acceptance criterion: *a rule referencing an unknown task kind or alias is rejected at
-- write time, not discovered at resolution time*. The names live inside jsonb, so this is a
-- deferred constraint trigger rather than a foreign key — and deferred is not unenforced,
-- which every probe below shows by asking for the check early.
select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"use_alias": {"task_kind": "triage", "alias": "coder-max"}}');
    set constraints ouroboros.escalation_rules_targets_exist immediate$$,
  'a rule naming a task kind the workspace does not have is refused when it is written',
  'escalation_rules_targets_exist');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"add_vote": {"task_kind": "review", "alias": "third-opinion"}}');
    set constraints ouroboros.escalation_rules_targets_exist immediate$$,
  'a rule naming an alias the workspace does not have is refused when it is written',
  'escalation_rules_targets_exist');

-- Tenancy, which is the same rule seen from the angle that matters: `bystander-only` is a
-- real alias, and it is not this workspace's. Without the workspace in the lookup, a rule
-- would resolve onto another workspace's model and credential — V015's failure, reached
-- through a jsonb document instead of a column.
select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 9, '{"effort_gte": "l"}',
            '{"use_alias": {"task_kind": "implement", "alias": "bystander-only"}}');
    set constraints ouroboros.escalation_rules_targets_exist immediate$$,
  'an alias that exists in another workspace is not an alias this workspace may name',
  'escalation_rules_targets_exist');

-- The other direction, which is what keeps the reference from going stale the first time
-- somebody tidies up: retiring a kind or renaming an alias a rule names is refused, exactly
-- as retiring an alias a hop names is (V016).
select pg_temp.must_reject(
  $$delete from ouroboros.task_kinds
     where organization_id = 'org-rules' and name = 'review';
    set constraints ouroboros.task_kinds_escalation_targets_exist immediate$$,
  'a task kind an escalation rule names cannot be retired out from under it',
  'task_kinds_escalation_targets_exist');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set alias = 'coder-ultra'
     where organization_id = 'org-rules' and alias = 'coder-max';
    set constraints ouroboros.model_aliases_escalation_targets_exist immediate$$,
  'an alias an escalation rule names cannot be renamed out from under it',
  'model_aliases_escalation_targets_exist');

select pg_temp.must_reject(
  $$delete from ouroboros.model_aliases
     where organization_id = 'org-rules' and alias = 'second-opinion';
    set constraints ouroboros.model_aliases_escalation_targets_exist immediate$$,
  'an alias an escalation rule names cannot be deleted out from under it',
  'model_aliases_escalation_targets_exist');

-- And the way through it, which is the whole reason the check is deferred: rename the alias
-- and update the rules that name it in one transaction, in either order, with no ceremony.
update ouroboros.model_aliases set alias = 'coder-ultra'
 where organization_id = 'org-rules' and alias = 'coder-max';
update ouroboros.escalation_rules
   set "then" = '{"use_alias": {"task_kind": "implement", "alias": "coder-ultra", "params": {"thinking": "max"}}}'
 where id = 'f0000000-0000-0000-0000-000000000001';
set constraints ouroboros.model_aliases_escalation_targets_exist immediate;
set constraints ouroboros.model_aliases_escalation_targets_exist deferred;

select pg_temp.must_hold(
  (select display = 'effort ≥ L → implement uses coder-ultra (max thinking)'
     from ouroboros.escalation_rules where id = 'f0000000-0000-0000-0000-000000000001'),
  'renaming an alias and its rules in one transaction succeeds, and the sentence follows');

-- Back to the mockup's name, by the same route.
update ouroboros.model_aliases set alias = 'coder-max'
 where organization_id = 'org-rules' and alias = 'coder-ultra';
update ouroboros.escalation_rules
   set "then" = '{"use_alias": {"task_kind": "implement", "alias": "coder-max", "params": {"thinking": "max"}}}'
 where id = 'f0000000-0000-0000-0000-000000000001';

-- `route_local` names neither a kind nor an alias, so it has nothing to be held against —
-- and a workspace with no local providers is resolution's honest failure (Z.1), not a rule
-- this schema refuses to store.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.escalation_rules
    where id = 'f0000000-0000-0000-0000-000000000003'),
  'route_local names nothing, so there is nothing for the reference check to refuse');

-- --- the evaluation order ------------------------------------------------------
--
-- Acceptance criterion: *sort_order gives rules a deterministic evaluation order*. Two rules
-- can match one run — `effort ≥ L` and `security label` on the same issue — so without an
-- order, which one swapped the model would depend on the query plan.
select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 1, '{"effort_gte": "xs"}', '{"route_local": {}}');
    set constraints ouroboros.escalation_rules_organization_sort_order_key immediate$$,
  'two rules cannot share a place in one workspace''s evaluation order',
  'escalation_rules_organization_sort_order_key');

select pg_temp.must_hold(
  (select condeferrable and condeferred from pg_constraint
    where conrelid = 'ouroboros.escalation_rules'::regclass
      and conname = 'escalation_rules_organization_sort_order_key'),
  'the order key is deferrable and initially deferred, which is what makes a drag plain SQL');

select pg_temp.must_reject(
  $$insert into ouroboros.escalation_rules (organization_id, sort_order, "when", "then")
    values ('org-rules', 0, '{"effort_gte": "xs"}', '{"route_local": {}}')$$,
  'the first rule is first, not zeroth', 'escalation_rules_sort_order_positive');

-- The reorder itself, in the form a drag really takes.
update ouroboros.escalation_rules
   set sort_order = case sort_order when 1 then 2 when 2 then 1 end
 where organization_id = 'org-rules' and sort_order in (1, 2);

select pg_temp.must_hold(
  (select array_agg(display order by sort_order) = array[
     'security label → review adds second-opinion vote',
     'effort ≥ L → implement uses coder-max (max thinking)',
     'docs-only diff → everything routes local']
     from ouroboros.escalation_rules where organization_id = 'org-rules'),
  'a one-statement reorder of the rules card succeeds inside a transaction');

update ouroboros.escalation_rules
   set sort_order = case sort_order when 1 then 2 when 2 then 1 end
 where organization_id = 'org-rules' and sort_order in (1, 2);

-- Deliberately not dense, like the matrix above it and unlike a hop chain: nothing counts
-- these numbers, so a card rendering `order by sort_order` draws 1, 2, 7 as it draws 1, 2, 3.
update ouroboros.escalation_rules set sort_order = 7
 where id = 'f0000000-0000-0000-0000-000000000003';

select pg_temp.must_hold(
  (select array_agg(sort_order order by sort_order) = array[1, 2, 7]
     from ouroboros.escalation_rules where organization_id = 'org-rules'),
  'the order is not required to be dense, because nothing reads the numbers themselves');

update ouroboros.escalation_rules set sort_order = 3
 where id = 'f0000000-0000-0000-0000-000000000003';

-- --- the switch ----------------------------------------------------------------
--
-- A suspended rule is a row, not an absence: it keeps its place in the order and the
-- sentence the card greys out, which is the whole difference between a rule turned off and
-- a rule that was never written.
update ouroboros.escalation_rules set enabled = false
 where id = 'f0000000-0000-0000-0000-000000000002';

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.escalation_rules
    where organization_id = 'org-rules' and enabled)
   and (select display = 'security label → review adds second-opinion vote' and sort_order = 2
          from ouroboros.escalation_rules where id = 'f0000000-0000-0000-0000-000000000002'),
  'switching a rule off leaves its sentence and its place, so switching it back on restores it');

update ouroboros.escalation_rules set enabled = true
 where id = 'f0000000-0000-0000-0000-000000000002';

-- --- the read the card makes ---------------------------------------------------
--
-- One workspace's rules in evaluation order, and the `where enabled` variant over the same
-- rows. Both enter through the leading column of the order key, which is why this migration
-- adds no index of its own — the fast path is the one a rule already paid for.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select display from ouroboros.escalation_rules
     where organization_id = 'org-rules' and enabled order by sort_order$$,
  'escalation_rules_organization_sort_order_key');
set local enable_seqscan = on;

-- --- the catalogue carries the decision and the grammar ------------------------
--
-- The table comment names decision M5, as V016's three name M1, M3 and M4 — so `\d+` and
-- any tool that reads a description gets the rule with the schema.
select pg_temp.must_hold(
  obj_description('ouroboros.escalation_rules'::regclass) like '%M5%',
  'the rules table names the decision it implements');

-- And the grammar is a domain rather than a column-level CHECK, which is what puts the
-- refusal before the derivation. A later migration that flattened these back to plain jsonb
-- would leave every assertion above green except this one.
select pg_temp.must_hold(
  (select array_agg(domain_name::text order by column_name)
          = array['escalation_rule_then', 'escalation_rule_when']
     from information_schema.columns
    where table_schema = 'ouroboros' and table_name = 'escalation_rules'
      and column_name in ('when', 'then')),
  'the two predicate columns are the domains, so their grammar is checked before display is derived');

-- --- the workspace cascade -----------------------------------------------------
--
-- The rules go with the workspace, and the reference trigger does not stand in the way of
-- it: the cascades are queued as after-triggers of the same statement, and by the time the
-- deferred check runs at commit there are no rules of that workspace left to validate.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.escalation_rules where organization_id = 'org-rules'),
  'the workspace about to be deleted really does have its rules');

delete from ouroboros.organization where "id" = 'org-rules';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.escalation_rules where organization_id = 'org-rules'),
  'deleting a workspace takes its escalation rules with it, reference check notwithstanding');

-- ===========================================================================
-- V019 — the alias switch, the unbound binding and the structured params (#579)
-- ===========================================================================
--
-- Y.1's `model_aliases` grown into mockup 21's management surface (decision **R1**), and
-- three of this ticket's criteria are rules that would be invisible if they were merely
-- intended:
--
--   * **The mockup's `gpt5-experiments` row is representable, and can never be switched
--     on.** A model id, no connection, `enabled = false` — and `enabled = true` on it is a
--     CHECK violation rather than a service's promise. Binding it and then enabling it is
--     the other half, because a rule that refused both would be indistinguishable here.
--   * **Params and restrictions are closed vocabularies.** An unknown key and an
--     out-of-range temperature are refused, which is what makes the chips derived from them
--     able to be true.
--   * **Nothing else changed.** Y.2's `route_hops` FK (#190) and AD.2's provider-delete
--     guard (#223) are asserted against the widened column rather than assumed to be
--     unaffected — a nullable foreign key column is exactly the change that quietly
--     loosens a reference somewhere else.
--
-- Its own fixtures again: the V018 section deleted `org-rules`, and no workspace above
-- survives with a connection to bind to. Two are created — one to own the aliases, one to
-- prove the workspace cascade still reaches them.

insert into ouroboros."user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values
  ('user-registrar', 'Reg Istrar', 'reg@registry-works.dev', true, now(), now());

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-registry', 'Registry Works', 'registry-works', now()),
  ('org-onlooker', 'Onlooker Works', 'onlooker-works', now());

insert into ouroboros.provider_connections (id, organization_id, kind, display_name) values
  ('f0000000-0000-0000-0000-00000000000a', 'org-registry', 'anthropic', 'Anthropic'),
  ('f0000000-0000-0000-0000-00000000000b', 'org-registry', 'cursor',    'Cursor'),
  ('f0000000-0000-0000-0000-00000000000e', 'org-onlooker', 'anthropic', 'Anthropic');

-- --- the mockup's last row, exactly ---------------------------------------------
--
-- Acceptance criterion: *the `gpt5-experiments` row is representable exactly — model id
-- present, no connection, `enabled = false`*. It is the one row V015 could not hold at all,
-- so this insert is the criterion rather than a fixture for one.
insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id, enabled) values
  ('f1000000-0000-0000-0000-00000000000a', 'org-registry', 'gpt5-experiments',
   null, 'gpt-5.2-preview', false);

select pg_temp.must_hold(
  (select provider_connection_id is null and model_id = 'gpt-5.2-preview' and not enabled
     from ouroboros.model_aliases where id = 'f1000000-0000-0000-0000-00000000000a'),
  'an alias created ahead of its key is a row: a model id, no connection, switch off');

-- --- and it can never be switched on --------------------------------------------
--
-- Acceptance criterion: *`UPDATE … SET enabled = true` on an unbound alias fails at the
-- CHECK constraint* (decision R2). Named, because a statement rejected by some other rule
-- would read as a pass and this is the rule the ticket is about.
select pg_temp.must_reject(
  $$update ouroboros.model_aliases set enabled = true
     where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  'an unbound alias can never be switched on', 'model_aliases_unbound_disabled');

-- The same refusal from the other direction: clearing the binding of an alias that is on.
-- Without this the CHECK could be satisfied by an INSERT-only rule and every UPDATE that
-- unbinds a live alias would pass.
insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id) values
  ('f1000000-0000-0000-0000-00000000000b', 'org-registry', 'coder-max',
   'f0000000-0000-0000-0000-00000000000a', 'claude-fable-5');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set provider_connection_id = null
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'unbinding an alias that is switched on is the same refusal, seen from the other side',
  'model_aliases_unbound_disabled');

-- And the default is deliberately not weakened to make the unbound insert convenient: an
-- alias created with no connection and no explicit switch takes `enabled` true from the
-- default and is refused. *This alias has no key yet and is off* is a statement the writer
-- makes.
select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases (organization_id, alias, model_id)
    values ('org-registry', 'silent-orphan', 'gpt-5.2-preview')$$,
  'an unbound alias that does not say it is off is refused rather than quietly corrected',
  'model_aliases_unbound_disabled');

-- --- binding it, and then enabling it, works ------------------------------------
--
-- Acceptance criterion: *binding an unbound alias to a connection and then enabling it
-- succeeds*. Two statements rather than one, because that is the order CH.1's rebind runs
-- them in and the order in which an intermediate state exists at all.
update ouroboros.model_aliases
   set provider_connection_id = 'f0000000-0000-0000-0000-00000000000b'
 where id = 'f1000000-0000-0000-0000-00000000000a';

update ouroboros.model_aliases set enabled = true
 where id = 'f1000000-0000-0000-0000-00000000000a';

select pg_temp.must_hold(
  (select enabled and provider_connection_id = 'f0000000-0000-0000-0000-00000000000b'
     from ouroboros.model_aliases where id = 'f1000000-0000-0000-0000-00000000000a'),
  'binding an unbound alias and then switching it on is the fix, and it is allowed');

-- Back to unbound, in the one order that is legal — switch off first — because the rest of
-- this section is about the state the migration exists for.
update ouroboros.model_aliases set enabled = false
 where id = 'f1000000-0000-0000-0000-00000000000a';
update ouroboros.model_aliases set provider_connection_id = null
 where id = 'f1000000-0000-0000-0000-00000000000a';

-- --- the composite foreign key is MATCH SIMPLE, which is why null is admitted ----
--
-- The property the unbound row rests on, asserted rather than inherited from a default
-- nobody looked at: under `MATCH SIMPLE` a reference with any null column is satisfied
-- without being checked, so `(org, null)` is not a dangling reference. Written `MATCH FULL`
-- the same foreign key would refuse every row above.
select pg_temp.must_hold(
  (select confmatchtype = 's' from pg_constraint
    where conname = 'model_aliases_provider_fk'
      and conrelid = 'ouroboros.model_aliases'::regclass),
  'the alias-to-connection key is MATCH SIMPLE, which is what lets a null binding exist beside a not-null organization');

-- The tenancy rule it exists for is unchanged for a bound alias: another workspace's
-- connection is still refused, and null is not a hole in that.
select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases (organization_id, alias, provider_connection_id, model_id)
    values ('org-registry', 'trespasser', 'f0000000-0000-0000-0000-00000000000e', 'claude-opus-5')$$,
  'a bound alias still cannot name another workspace''s connection', 'model_aliases_provider_fk');

-- --- the params vocabulary ------------------------------------------------------
--
-- Acceptance criterion: *`params` rejects an unknown key and an out-of-range temperature*.
-- Every probe below writes a well-formed object, so `model_aliases_params_object` (V015)
-- cannot be the rule that fires and the constraint name is the assertion.
update ouroboros.model_aliases
   set params = '{"thinking": "max", "token_budget": 400000}'
 where id = 'f1000000-0000-0000-0000-00000000000b';

select pg_temp.must_hold(
  (select params = '{"thinking": "max", "token_budget": 400000}'::jsonb
     from ouroboros.model_aliases where id = 'f1000000-0000-0000-0000-00000000000b'),
  'the mockup''s (max thinking)(400k budget) chips are one params document');

-- The whole vocabulary is storable — the CHECK is a vocabulary, not a subset of one — and
-- each of the mockup's other chips is one of these.
select pg_temp.must_hold(
  (select bool_and(ouroboros.model_alias_params_valid(document))
     from (values ('{"thinking": "off"}'::jsonb),
                  ('{"thinking": "std"}'::jsonb),
                  ('{"thinking": "max"}'::jsonb),
                  ('{"temperature": 0}'::jsonb),
                  ('{"temperature": 2}'::jsonb),
                  ('{"temperature": 0.2}'::jsonb),
                  ('{"max_output": 8000}'::jsonb),
                  ('{"context_clamp": 32000}'::jsonb),
                  ('{"token_budget": 10000000}'::jsonb),
                  ('{}'::jsonb)) as documents (document)),
  'every key and bound the vocabulary names is storable, including the empty document');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"top_p": 0.9}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'an unknown params key is refused, because a chip is derived from this document and nothing derives that one',
  'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"temperature": 3.0}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a temperature no vendor accepts is refused at the shape', 'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"temperature": -0.1}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'and so is a negative one', 'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"thinking": "maximum"}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a fourth thinking level is refused here exactly as a sixth provider kind is on a connection',
  'model_aliases_params_known');

-- Zero is refused for all three token counts: a budget of zero tokens is not a small
-- budget, and every place it could be typed meant to clear the field instead — which is
-- removing the key.
select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"token_budget": 0}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a token budget of zero is a param meaning "do not answer", not an unset one',
  'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"max_output": 1.5}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a token count is whole', 'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"context_clamp": 10000001}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'and bounded, so a unit mistake is caught rather than stored', 'model_aliases_params_known');

-- The types are checked, not coerced. `"400000"` is what a form submits when nothing parsed
-- it, and a reader that only asked whether the key was there would carry it to a provider.
select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"token_budget": "400000"}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a token budget is a number, not the string a form submits when nothing parsed it',
  'model_aliases_params_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"thinking": null}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a JSON null is not how a param is cleared; removing the key is', 'model_aliases_params_known');

-- The two constraints on this column own one rule each, and the V015 section above is what
-- would go red if that stopped being true: *params is an object* is
-- `model_aliases_params_object` and stays its refusal, while this one is about keys and
-- values. The validator is nonetheless total — false rather than an error for a document it
-- is not asked about — which is what lets the guard in the constraint expression be correct
-- whichever side PostgreSQL evaluates first.
select pg_temp.must_hold(
  (select not ouroboros.model_alias_params_valid('[]'::jsonb)
      and not ouroboros.model_alias_params_valid('"max"'::jsonb)
      and not ouroboros.model_alias_restrictions_valid('[]'::jsonb)),
  'both validators answer false for a document that is not an object, rather than raising');

-- --- the restrictions vocabulary ------------------------------------------------
--
-- Acceptance criterion: *`restrictions` rejects an unknown flag*. Two flags, boolean, and
-- the reason they are not params is in the migration header: a restriction never leaves
-- this product.
update ouroboros.model_aliases
   set restrictions = '{"review_vote_only": true}'
 where id = 'f1000000-0000-0000-0000-00000000000b';

select pg_temp.must_hold(
  (select ouroboros.model_alias_restrictions_valid('{"review_vote_only": true, "batch_ok": false}')
      and ouroboros.model_alias_restrictions_valid('{}')),
  'both flags are storable together, in either position, and the empty document is the ordinary one');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set restrictions = '{"batch_okay": true}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'an unknown restriction flag is refused', 'model_aliases_restrictions_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set restrictions = '{"batch_ok": "true"}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a flag is a boolean, not the string a form submits', 'model_aliases_restrictions_known');

-- A param key is not a restriction key and a restriction key is not a param key. The two
-- documents are separate because the two concepts are, and a validator that shared a
-- vocabulary would make that separation a convention.
select pg_temp.must_reject(
  $$update ouroboros.model_aliases set restrictions = '{"thinking": "max"}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a param is not a restriction', 'model_aliases_restrictions_known');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set params = '{"batch_ok": true}'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'and a restriction is not a param', 'model_aliases_params_known');

-- --- notes and authorship -------------------------------------------------------
update ouroboros.model_aliases
   set notes = 'Dev key. Do not point production routes at this.',
       updated_by = 'user-registrar'
 where id = 'f1000000-0000-0000-0000-00000000000b';

select pg_temp.must_hold(
  (select notes like 'Dev key.%' and updated_by = 'user-registrar'
     from ouroboros.model_aliases where id = 'f1000000-0000-0000-0000-00000000000b'),
  'an alias carries an operator''s note and who last wrote it');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set notes = '   '
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'a blank note renders as an empty note rather than as no note, so it is refused',
  'model_aliases_notes_present');

select pg_temp.must_reject(
  $$update ouroboros.model_aliases set updated_by = 'nobody-at-all'
     where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'an alias cannot be attributed to a person who does not exist', 'model_aliases_updated_by_fk');

-- Sets null rather than cascading: deleting the person who last edited an alias must not
-- delete the alias, exactly as V011, V016 and V017 decided for their own authorship columns.
delete from ouroboros."user" where "id" = 'user-registrar';

select pg_temp.must_hold(
  (select updated_by is null and alias = 'coder-max'
     from ouroboros.model_aliases where id = 'f1000000-0000-0000-0000-00000000000b'),
  'deleting the person who last edited an alias loses the attribution and keeps the alias');

-- --- V017's soft validation has nothing to say about an unbound alias -----------
--
-- The warning (#221, decision P6) tells a *gap* from a *mismatch*, and an unbound alias is
-- neither: there is no connection to have discovered anything. Left unamended it would take
-- the gap branch and report *nothing has been discovered on it yet* about a connection that
-- does not exist — a warning nobody can act on, raised on the one write this migration
-- exists to make possible. A warning cannot be caught in SQL, so what is asserted is the
-- half that can be: the predicate the function guards on, and that the trigger still
-- watches the same two columns V017 gave it.
select pg_temp.must_hold(
  not ouroboros.provider_model_discovered(null, 'gpt-5.2-preview'),
  'nothing is discovered on a connection that is not there, which is the branch the amendment skips');

select pg_temp.must_hold(
  (select array_agg(att.attname::text order by att.attname) = array['model_id', 'provider_connection_id']
     from pg_trigger trg
     cross join lateral unnest(trg.tgattr) as columns (attnum)
     join pg_attribute att
       on att.attrelid = trg.tgrelid and att.attnum = columns.attnum
    where trg.tgrelid = 'ouroboros.model_aliases'::regclass
      and trg.tgname = 'model_aliases_warn_undiscovered_model'),
  'replacing the function left V017''s trigger and its column list exactly as they were');

-- --- Y.2's hop reference is unaffected by the widened column ---------------------
--
-- Acceptance criterion: *`route_hops`'s FK (#190) behaves exactly as before —
-- regression-verified, not assumed*. A hop names an alias by id; whether that alias has a
-- provider binding is not a referential question, and the `restrict` that stops an alias
-- being retired out from under a chain still fires — including for an alias that is
-- unbound and switched off, which is the row that did not exist when the rule was written.
insert into ouroboros.task_kinds (organization_id, name, description, sort_order) values
  ('org-registry', 'implement', 'Write the change, run tests, iterate to green', 4);

insert into ouroboros.routes (id, organization_id, task_kind_id, tag)
select 'f2000000-0000-0000-0000-00000000000a', 'org-registry', id, 'implement-primary'
  from ouroboros.task_kinds where organization_id = 'org-registry' and name = 'implement';

insert into ouroboros.route_hops (organization_id, route_id, position, model_alias_id) values
  ('org-registry', 'f2000000-0000-0000-0000-00000000000a', 1,
   'f1000000-0000-0000-0000-00000000000b'),
  ('org-registry', 'f2000000-0000-0000-0000-00000000000a', 2,
   'f1000000-0000-0000-0000-00000000000a');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.route_hops
    where route_id = 'f2000000-0000-0000-0000-00000000000a'),
  'a chain may name an unbound, switched-off alias — resolution drops the hop with an explanation, the schema does not refuse it');

select pg_temp.must_reject(
  $$delete from ouroboros.model_aliases where id = 'f1000000-0000-0000-0000-00000000000b'$$,
  'an alias a chain names still cannot be retired out from under it', 'route_hops_alias_fk');

select pg_temp.must_reject(
  $$delete from ouroboros.model_aliases where id = 'f1000000-0000-0000-0000-00000000000a'$$,
  'and the unbound one is protected by exactly the same key', 'route_hops_alias_fk');

-- --- AD.2's provider-delete guard is unaffected, in both of its directions --------
--
-- Acceptance criterion: *AD.2's provider-delete guard (#223) behaves exactly as before*.
-- It is `model_aliases_provider_fk`'s `restrict`, plus the read that lets the refusal name
-- the aliases responsible. Both are asserted against the widened column, because the
-- failure mode a nullable foreign key introduces is silent: an unbound alias counting as a
-- dependant would block a deletion nothing depends on.
select pg_temp.must_reject(
  $$delete from ouroboros.provider_connections
     where id = 'f0000000-0000-0000-0000-00000000000a'$$,
  'a connection with dependent aliases still cannot be deleted', 'model_aliases_provider_fk');

-- The pre-flight AD.2 builds its message from — `where provider_connection_id = $1` — never
-- matches null, so the unbound alias is not in the list and does not stand in the way of a
-- connection it has nothing to do with.
select pg_temp.must_hold(
  (select array_agg(alias order by alias) = array['coder-max']
     from ouroboros.model_aliases
    where organization_id = 'org-registry'
      and provider_connection_id = 'f0000000-0000-0000-0000-00000000000a'),
  'the aliases-for-a-connection read names the bound alias and not the unbound one');

delete from ouroboros.provider_connections
 where id = 'f0000000-0000-0000-0000-00000000000b';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_aliases
    where organization_id = 'org-registry'
      and provider_connection_id = 'f0000000-0000-0000-0000-00000000000b'),
  'and a connection no alias depends on is still deletable, with the unbound alias sitting beside it');

-- --- uniqueness per workspace still holds ---------------------------------------
--
-- Acceptance criterion: *alias uniqueness per organization still holds*. V015's key is
-- untouched by four new columns and a widened one, and the unbound row is inside it rather
-- than beside it — a second `gpt5-experiments`, bound or not, is the same name twice.
select pg_temp.must_reject(
  $$insert into ouroboros.model_aliases (organization_id, alias, model_id, enabled)
    values ('org-registry', 'gpt5-experiments', 'gpt-5.3-preview', false)$$,
  'an unbound alias is inside the per-workspace uniqueness rule, not an exception to it',
  'model_aliases_organization_alias_key');

insert into ouroboros.model_aliases (organization_id, alias, model_id, enabled) values
  ('org-onlooker', 'gpt5-experiments', 'gpt-5.2-preview', false);

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.model_aliases where alias = 'gpt5-experiments'),
  'and it is scoped per workspace, exactly as a bound one is');

-- --- the reads ------------------------------------------------------------------
--
-- The registry's table read (CI.1, #588) is one statement over two indexes and no sort —
-- which is why this migration adds none for it. `must_not_scan` rather than naming one
-- index: naming one proves that one relation was entered through it and says nothing about
-- the other, and the criterion is about the whole query.
--
-- `analyze` first, for the reason the V015 section gives at length: without statistics the
-- candidate entry points cost the same and the assertion measures a tie-break rather than a
-- plan. The rows these two statements are about were written by this section, long after
-- that one ran.
analyze ouroboros.model_aliases;
analyze ouroboros.provider_connections;

set local enable_seqscan = off;
select pg_temp.must_not_scan(
  $$select a.alias, a.model_id, a.enabled, a.params, a.restrictions,
           c.kind, c.display_name, c.status
      from ouroboros.model_aliases a
      left join ouroboros.provider_connections c
        on c.organization_id = a.organization_id and c.id = a.provider_connection_id
     where a.organization_id = 'org-registry'
     order by a.alias$$);

select pg_temp.must_use_index(
  $$select a.alias from ouroboros.model_aliases a
     where a.organization_id = 'org-registry' order by a.alias$$,
  'model_aliases_organization_alias_key');

-- The one index this migration does add, and the read it was added for: the workspace's
-- unbound aliases, which is the set mockup 21 dims and offers `Fix in Providers →` on.
select pg_temp.must_use_index(
  $$select alias from ouroboros.model_aliases
     where organization_id = 'org-registry' and provider_connection_id is null
     order by alias$$,
  'model_aliases_unbound_idx');
set local enable_seqscan = on;

-- Partial, and that is the claim rather than an implementation detail: a full index on the
-- same columns would carry every alias in the workspace to answer a question about the few
-- that have no binding.
select pg_temp.must_hold(
  (select indpred is not null
      and pg_get_expr(indpred, indrelid) = '(provider_connection_id IS NULL)'
     from pg_index where indexrelid = 'ouroboros.model_aliases_unbound_idx'::regclass),
  'the unbound index is partial, so it holds nothing at all in a workspace where every alias has a key');

-- --- the catalogue carries the decision -----------------------------------------
--
-- V015's table comment named mockup 21 as what it was a foundation *for*; it now has to say
-- that the surface arrived, because `\d+` is where a reader meets this table without the
-- migration beside it.
select pg_temp.must_hold(
  (select obj_description('ouroboros.model_aliases'::regclass) like '%unbound%'
      and obj_description('ouroboros.model_aliases'::regclass) like '%On switch%'),
  'model_aliases says it holds the switch and the unbound state, in the database');

-- --- the workspace cascade still reaches every one of them ----------------------
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.model_aliases where organization_id = 'org-registry'),
  'the workspace about to be deleted really does still have its aliases');

delete from ouroboros.organization where "id" = 'org-registry';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.model_aliases where organization_id = 'org-registry')
   and (select count(*) = 0 from ouroboros.provider_connections where organization_id = 'org-registry')
   and (select count(*) = 0 from ouroboros.route_hops where organization_id = 'org-registry'),
  'deleting a workspace still takes its aliases, its connections and its chains — the unbound alias included');


-- ===========================================================================
-- V021 — route_revisions, the audit trail behind Save routes (#195)
-- ===========================================================================
--
-- Mockup 06's editing model is staged: edits accumulate in the browser and commit as one
-- batch when **Save routes** is pressed. V016 said what would record that press —
--
--   > When versioned route configuration arrives it is history in a table of its own, where
--   > a superseded revision cannot be mistaken for a route that is merely switched off.
--
-- — and this is the section that holds the table to it. Three rules are the point of the
-- migration rather than incidental to it, so each is asserted with the constraint named:
--
--   * **a diff has a shape**, and a jsonb column with no rule would hold four of them
--     within a year — one per service that ever wrote to it. #26 reads these rows.
--   * **a save that changed nothing cannot be stored**, which is the same rule seen from
--     the other end: `routes` is non-empty and every `changes` is non-empty, so the
--     no-op revision is unstorable rather than merely not written.
--   * **the actor is set null and never cascaded.** Deleting the person deletes neither
--     the record of what they changed nor the workspace's history of it.
--
-- Its own fixtures again: the V019 section deleted `org-registry` on its way out.

insert into ouroboros."user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values
  ('user-saver', 'Sav Er', 'sav@routes-works.dev', true, now(), now());

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-revisions', 'Routes Works', 'routes-works', now());

-- --- one press of Save routes ---------------------------------------------------
--
-- The document the header of V021 draws, inserted whole: a reorder, a floor being set and a
-- cap being raised, on one task kind, in one batch.
insert into ouroboros.route_revisions (id, organization_id, actor, diff) values
  ('a1000000-0000-0000-0000-000000000001', 'org-revisions', 'user-saver', $${
     "routes": [
       {
         "task_kind": "implement",
         "changes": {
           "hops": {"from": [{"alias": "coder-max", "note": "Primary"}],
                    "to":   [{"alias": "coder-max", "note": "Primary"},
                             {"alias": "local-docs", "note": null}]},
           "floor_hop_index": {"from": null, "to": 2},
           "max_cost_cents_per_run": {"from": 250, "to": 500}
         }
       }
     ]
   }$$);

select pg_temp.must_hold(
  (select diff -> 'routes' -> 0 ->> 'task_kind' = 'implement'
      and jsonb_array_length(diff -> 'routes' -> 0 -> 'changes' -> 'hops' -> 'to') = 2
      and diff -> 'routes' -> 0 -> 'changes' -> 'floor_hop_index' ->> 'to' = '2'
     from ouroboros.route_revisions
    where id = 'a1000000-0000-0000-0000-000000000001'),
  'a revision round-trips the batch it recorded — the chain, the floor and the cap, each as a from/to pair');

-- --- what a diff may not be -----------------------------------------------------
--
-- Every rejection names `route_revisions_diff_shape`, because a document refused by a
-- not-null or by a type error would read as a working check while the grammar was missing
-- entirely.
select pg_temp.must_reject(
  $$insert into ouroboros.route_revisions (organization_id, diff)
    values ('org-revisions', '{"routes": []}')$$,
  'a save that changed no route is not a revision',
  'route_revisions_diff_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.route_revisions (organization_id, diff)
    values ('org-revisions', '{"routes": [{"task_kind": "implement", "changes": {}}]}')$$,
  'a route that changed nothing is not an entry',
  'route_revisions_diff_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.route_revisions (organization_id, diff)
    values ('org-revisions',
            '{"routes": [{"task_kind": "implement", "changes": {"tag": {"from": "a"}}}]}')$$,
  'a change has two sides, so a from with no to is not one',
  'route_revisions_diff_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.route_revisions (organization_id, diff)
    values ('org-revisions',
            '{"routes": [{"task_kind": "Implement", "changes": {"tag": {"from": "a", "to": "b"}}}]}')$$,
  'a task kind in a diff is shaped as task_kinds.name is, so a diff can only name something that table could hold',
  'route_revisions_diff_shape');

select pg_temp.must_reject(
  $$insert into ouroboros.route_revisions (organization_id, diff)
    values ('org-revisions',
            '{"routes": [{"task_kind": "implement", "changes": {"tag": {"from": "a", "to": "b"}}}], "rules": []}')$$,
  'a second vocabulary cannot be smuggled in beside routes',
  'route_revisions_diff_shape');

-- --- the actor is a record, not a dependency ------------------------------------
--
-- Deleting the person who pressed Save must not delete what they changed: `on delete set
-- null`, exactly as `routes.updated_by` has it and for the same reason. A cascade here
-- would empty the audit trail of everybody who has ever left.
delete from ouroboros."user" where "id" = 'user-saver';

select pg_temp.must_hold(
  (select actor is null from ouroboros.route_revisions
    where id = 'a1000000-0000-0000-0000-000000000001'),
  'deleting the actor empties the attribution and keeps the revision');

-- A revision is an event, and an event has no updated_at to move.
select pg_temp.must_hold(
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'ouroboros' and table_name = 'route_revisions'
      and column_name = 'updated_at'),
  'there is no updated_at on an append-only table, so nothing can quietly rewrite a revision');

-- --- the one read this table has ------------------------------------------------
--
-- A workspace's revisions, newest first — what #26 pages and where a support question
-- about a routing change starts.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select id from ouroboros.route_revisions
     where organization_id = 'org-revisions' order by created_at desc, id desc$$,
  'route_revisions_organization_created_at_idx');
set local enable_seqscan = on;

-- --- the catalogue carries the decision -----------------------------------------
select pg_temp.must_hold(
  obj_description('ouroboros.route_revisions'::regclass) like '%Save routes%'
   and obj_description('ouroboros.route_revisions'::regclass) like '%#26%',
  'the revisions table says what writes it and what reads it, in the database');

-- --- the workspace cascade ------------------------------------------------------
--
-- History goes with the workspace it is history of.
delete from ouroboros.organization where "id" = 'org-revisions';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.route_revisions where organization_id = 'org-revisions'),
  'deleting a workspace takes its routing history with it');


-- ===========================================================================
-- V022 — audit_events, the credential trail (#225)
-- ===========================================================================
--
-- Decision **P5** puts credential auditing in the MVP: a page that reveals and rotates keys
-- while keeping no record of who did it fails its own stated security posture. This is #26's
-- `audit_events`, landed early by AD.4 so that there is one audit schema rather than two.
--
-- Four rules are the point of the migration rather than incidental to it:
--
--   * **append-only, and enforced twice** — by grant for a deployment that connects as
--     `ouroboros_app`, and by trigger for the development stack that connects as the owner
--     and would otherwise bypass every grant in the catalogue.
--   * **the subject is deliberately not referential**, because `provider.deleted` is exactly
--     the event a foreign key would make unwritable.
--   * **the actor is a record, not a dependency** — set null, never cascade, on
--     `route_revisions.actor`'s argument.
--   * **the workspace cascade is why there is no delete trigger**, and both halves of that
--     sentence are asserted below.
--
-- Its own fixtures again: the V021 section deleted `org-revisions` on its way out.

insert into ouroboros."user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") values
  ('user-auditor', 'Aud Itor', 'aud@keys-works.dev', true, now(), now());

insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-audit', 'Keys Works', 'keys-works', now()),
  ('org-audit-other', 'Other Works', 'other-works', now());

-- --- one reveal, recorded whole -------------------------------------------------
--
-- Every column the endpoint reads back, written in one insert: who, what, to which subject,
-- from where, and the detail payload that says how the step-up was satisfied.
insert into ouroboros.audit_events
    (id, organization_id, actor_id, action, subject_type, subject_id, ip, detail) values
  ('b2000000-0000-0000-0000-000000000001', 'org-audit', 'user-auditor',
   'provider.revealed', 'provider_connection', 'b2000000-0000-0000-0000-0000000000c1',
   '203.0.113.7', '{"kind": "anthropic", "step_up": "password"}');

select pg_temp.must_hold(
  (select action = 'provider.revealed'
      and subject_type = 'provider_connection'
      and detail ->> 'step_up' = 'password'
      and ip = '203.0.113.7'::inet
      and occurred_at is not null
     from ouroboros.audit_events
    where id = 'b2000000-0000-0000-0000-000000000001'),
  'an event round-trips what happened — the action, the subject, the address and the payload');

-- `ip` is an `inet` rather than text, and both halves of that choice are asserted below: a
-- value in this column is an address rather than something that was once claimed to be one,
-- and *everything from this subnet* is an operator rather than a prefix match on a string.
insert into ouroboros.audit_events
    (id, organization_id, action, subject_type, subject_id, ip) values
  ('b2000000-0000-0000-0000-000000000002', 'org-audit',
   'credential.lease_granted', 'run', 'b2000000-0000-0000-0000-0000000000r1', '10.0.4.20');

select pg_temp.must_raise(
  $$insert into ouroboros.audit_events (organization_id, action, subject_type, ip)
    values ('org-audit', 'provider.added', 'provider_connection', 'not-an-address')$$,
  '22P02',
  'an address column holds addresses, so a forwarded header cannot put arbitrary text into the trail');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.audit_events
    where organization_id = 'org-audit' and ip << '10.0.4.0/24'::inet),
  'everything from this subnet is one operator, which is the query an investigation actually runs');

-- A lease grant has no person behind it — a worker authenticates with a service key — so the
-- actor is null rather than invented.
select pg_temp.must_hold(
  (select actor_id is null
     from ouroboros.audit_events
    where id = 'b2000000-0000-0000-0000-000000000002'),
  'an event with no person behind it says so, rather than naming one');

-- --- what an event may not be ---------------------------------------------------
--
-- The grammar rules exist so that `where action = 'provider.revealed'` finds every reveal.
-- Each rejection names its constraint, because a row refused by a not-null would read as a
-- working check while the grammar was missing entirely.
select pg_temp.must_reject(
  $$insert into ouroboros.audit_events (organization_id, action, subject_type)
    values ('org-audit', 'Provider.Revealed', 'provider_connection')$$,
  'an action is lower snake on both sides, so one writer cannot spell an event differently from the rest',
  'audit_events_action_grammar');

select pg_temp.must_reject(
  $$insert into ouroboros.audit_events (organization_id, action, subject_type)
    values ('org-audit', 'revealed', 'provider_connection')$$,
  'an action names its family, so the trail can be filtered by one',
  'audit_events_action_grammar');

select pg_temp.must_reject(
  $$insert into ouroboros.audit_events (organization_id, action, subject_type)
    values ('org-audit', 'provider.revealed', 'ProviderConnection')$$,
  'a subject type is shaped like the table it names',
  'audit_events_subject_type_grammar');

select pg_temp.must_reject(
  $$insert into ouroboros.audit_events (organization_id, action, subject_type, detail)
    values ('org-audit', 'provider.revealed', 'provider_connection', '"a bare string"')$$,
  'a detail payload is an object, so the secrecy grep and every reader can enumerate its keys',
  'audit_events_detail_is_object');

-- --- append-only ----------------------------------------------------------------
--
-- The half a grant cannot enforce. `restrict_violation` (23001) rather than a constraint
-- name, because the refusal is a trigger's and a trigger has none — `must_raise` is the
-- sibling assertion for exactly that case.
select pg_temp.must_raise(
  $$update ouroboros.audit_events set action = 'provider.added'
     where id = 'b2000000-0000-0000-0000-000000000001'$$,
  '23001',
  'an audit event cannot be revised, by any role including the owner of this database');

select pg_temp.must_raise(
  $$update ouroboros.audit_events set detail = '{}'::jsonb where organization_id = 'org-audit'$$,
  '23001',
  'and not in bulk either — the refusal is per row, so a sweeping update refuses on the first of them');

-- The single exception, and its edges. `actor_id` may be **erased**, because the actor
-- foreign key's own `on delete set null` is an UPDATE and a trigger that refused it would be
-- making people undeletable rather than making events immutable. Everything adjacent to that
-- one statement is still refused, which is what keeps the exception from being a hole:
-- re-attributing an event, and editing a payload under cover of clearing the actor.
select pg_temp.must_raise(
  $$update ouroboros.audit_events set actor_id = 'user-auditor'
     where id = 'b2000000-0000-0000-0000-000000000002'$$,
  '23001',
  'an event cannot be attributed to somebody after the fact, which is the direction that would matter');

select pg_temp.must_raise(
  $$update ouroboros.audit_events
       set actor_id = null, detail = '{"step_up": "session"}'::jsonb
     where id = 'b2000000-0000-0000-0000-000000000001'$$,
  '23001',
  'a payload cannot be edited under cover of clearing the actor — the exception is the attribution and nothing beside it');

-- The other half. `ouroboros_app` is the role a deployment that separates migrating from
-- running connects the API as, and what it may do to this table is the whole of AD.4's
-- append-only criterion.
select pg_temp.must_hold(
  has_table_privilege('ouroboros_app', 'ouroboros.audit_events', 'select')
   and has_table_privilege('ouroboros_app', 'ouroboros.audit_events', 'insert')
   and not has_table_privilege('ouroboros_app', 'ouroboros.audit_events', 'update')
   and not has_table_privilege('ouroboros_app', 'ouroboros.audit_events', 'delete'),
  'the application role may read and append and may do nothing else — append-only at the grant level');

-- A role that cannot reach the schema cannot reach the table either, whatever the table
-- grant says. Asserted because the two are separate grants and the second is easy to forget.
select pg_temp.must_hold(
  has_schema_privilege('ouroboros_app', 'ouroboros', 'usage'),
  'the application role can reach the schema its one grant is in');

-- An event is an event, and an event has no updated_at to move.
select pg_temp.must_hold(
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'ouroboros' and table_name = 'audit_events'
      and column_name = 'updated_at'),
  'there is no updated_at on an append-only table, so nothing can quietly rewrite an event');

-- --- the subject is deliberately not referential ---------------------------------
--
-- `provider.deleted` is the event whose subject no longer exists by the time anybody reads
-- it. A foreign key would make the most important row in the trail the one row that cannot
-- be written, so there is none — and its absence is asserted rather than assumed, because an
-- FK added later by somebody being tidy would break exactly that row.
select pg_temp.must_hold(
  (select count(*) = 0
     from information_schema.table_constraints
    where table_schema = 'ouroboros' and table_name = 'audit_events'
      and constraint_type = 'FOREIGN KEY'
      and constraint_name like '%subject%'),
  'nothing constrains the subject, so an event about a connection outlives the connection');

insert into ouroboros.audit_events
    (id, organization_id, actor_id, action, subject_type, subject_id, detail) values
  ('b2000000-0000-0000-0000-000000000003', 'org-audit', 'user-auditor',
   'provider.deleted', 'provider_connection', 'b2000000-0000-0000-0000-00000000dead',
   '{"kind": "cursor"}');

select pg_temp.must_hold(
  (select subject_id = 'b2000000-0000-0000-0000-00000000dead'
     from ouroboros.audit_events
    where id = 'b2000000-0000-0000-0000-000000000003'),
  'a deletion can be recorded against the row it deleted, which is the point of recording it');

-- --- the actor is a record, not a dependency ------------------------------------
--
-- Deleting the person must not delete what they did: `on delete set null`, exactly as
-- `route_revisions.actor` has it and for the same reason. A cascade here would empty the
-- audit trail of everybody who has ever left — which is the trail an investigation most
-- often needs.
delete from ouroboros."user" where "id" = 'user-auditor';

select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.audit_events where organization_id = 'org-audit')
   and (select count(*) = 0 from ouroboros.audit_events
         where organization_id = 'org-audit' and actor_id is not null)
   and (select detail ->> 'step_up' = 'password'
          from ouroboros.audit_events
         where id = 'b2000000-0000-0000-0000-000000000001'),
  'deleting the actor empties the attribution, keeps every event they wrote, and changes nothing else about them');

-- --- the one read this table has ------------------------------------------------
--
-- A workspace's events, newest first — `GET /api/v1/providers/audit`, and where any "who
-- touched this key" question starts. The endpoint's filters (connection, actor, action)
-- narrow a set that has already entered through this index's leading column.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select id from ouroboros.audit_events
     where organization_id = 'org-audit' order by occurred_at desc, id desc$$,
  'audit_events_organization_occurred_at_idx');
select pg_temp.must_use_index(
  $$select id from ouroboros.audit_events
     where organization_id = 'org-audit' and action = 'provider.revealed'
     order by occurred_at desc, id desc$$,
  'audit_events_organization_occurred_at_idx');
set local enable_seqscan = on;

-- --- the catalogue carries the decision -----------------------------------------
select pg_temp.must_hold(
  (select lower(obj_description('ouroboros.audit_events'::regclass)) like '%append-only%'
      and lower(obj_description('ouroboros.audit_events'::regclass)) like '%#26%'
      and lower(obj_description('ouroboros.audit_events'::regclass)) like '%secret material%'),
  'the audit table says what it is, whose shape it holds and what it must never carry, in the database');

-- --- the workspace cascade, and why there is no delete trigger -------------------
--
-- A workspace's trail is that workspace's and goes with it, on the same reasoning
-- `tenant_keys` cascades. This assertion is also the argument for the asymmetry above: a
-- `before delete` trigger would make the statement below fail, so it would not be enforcing
-- append-only — it would be making workspace deletion impossible.
delete from ouroboros.organization where "id" = 'org-audit';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.audit_events where organization_id = 'org-audit'),
  'deleting a workspace takes its audit trail with it, which a delete-refusing trigger would have prevented');

delete from ouroboros.organization where "id" = 'org-audit-other';


-- ===========================================================================
-- V023 — alias_references, the one answer to "what references this alias?" (#581)
-- ===========================================================================
--
-- Mockup 21 asks that question four times on one screen — the `USED BY` column, the
-- inspector's chip list, the blocked *Remove* button and the rename the same panel offers —
-- and decision **R5** makes it one definition rather than four agreeing implementations.
-- What is asserted here is that the definition answers the mockup, and that the two guards
-- built on it refuse what they are supposed to refuse:
--
--   * **`coder-max` returns the mockup's four chips exactly** — three route tags and one
--     escalation label — *and nothing else*, which is the half a count would pass without.
--   * **Counts are computed, not stored**, including the zero: an alias nothing references
--     is `0` because a left join produced no rows, not because a column says so.
--   * **The unbuilt legs are zero rows rather than an error.** `workflow` and `chat_pin`
--     have no storage yet (#132/#133 and #537); the vocabulary declares them anyway, so the
--     output shape is stable and a fifth kind is a migration rather than a typo.
--   * **The chip cannot drift from V018's sentence**, which is the one real cost of
--     rendering the predicate twice and is why it is asserted rather than trusted.
--   * **Both guards refuse.** A hop's reference is a foreign key and a rule's is a name
--     inside jsonb; delete is refused by each, and rename by the second — which is the
--     whole reason rename is guarded at all.
--
-- What no assertion in this file can reach is the *lock*: a race needs two sessions and
-- this is one, inside one transaction. tests/verify-alias-reference-guard.sh is that proof,
-- and .github/workflows/db.yml runs it.
--
-- Its own fixtures again: the V022 section deleted both of its workspaces on the way out.

-- Two workspaces and no person: nothing this section asserts is about authorship, and every
-- `updated_by` in the routing tables is nullable, so a user fixture here would be a row
-- nothing reads.
insert into ouroboros.organization ("id", "name", "slug", "createdAt") values
  ('org-refs', 'Refs Works', 'refs-works', now()),
  ('org-refs-other', 'Other Refs Works', 'other-refs-works', now());

insert into ouroboros.provider_connections (id, organization_id, kind, display_name) values
  ('f4000000-0000-0000-0000-00000000000a', 'org-refs', 'anthropic', 'Anthropic Claude');

-- A connection whose catalogue has been discovered, so the aliases below bind to models
-- V017's soft validation (#221, decision P6) can see. Nothing in this section is about that
-- rule; seeding the three models is how it is kept quiet rather than tolerated, and a
-- fixture where discovery has run is the ordinary state anyway.
insert into ouroboros.provider_models (id, provider_connection_id, model_id, display) values
  ('f4000000-0000-0000-0000-0000000000a1', 'f4000000-0000-0000-0000-00000000000a', 'claude-fable-5',   'Claude Fable 5'),
  ('f4000000-0000-0000-0000-0000000000a2', 'f4000000-0000-0000-0000-00000000000a', 'claude-sonnet-5',  'Claude Sonnet 5'),
  ('f4000000-0000-0000-0000-0000000000a3', 'f4000000-0000-0000-0000-00000000000a', 'claude-haiku-4-5', 'Claude Haiku 4.5');

-- The workspace's four aliases. `local-free` is the fixture for the mockup's `0 routes`
-- row: nothing names it, and the point of the assertions below is that it still reads as a
-- number rather than as a missing row.
insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id) values
  ('f4100000-0000-0000-0000-000000000001', 'org-refs', 'coder-max',
   'f4000000-0000-0000-0000-00000000000a', 'claude-fable-5'),
  ('f4100000-0000-0000-0000-000000000002', 'org-refs', 'second-opinion',
   'f4000000-0000-0000-0000-00000000000a', 'claude-sonnet-5'),
  ('f4100000-0000-0000-0000-000000000003', 'org-refs', 'local-free',
   'f4000000-0000-0000-0000-00000000000a', 'claude-haiku-4-5'),
  ('f4100000-0000-0000-0000-000000000004', 'org-refs', 'coder-std',
   'f4000000-0000-0000-0000-00000000000a', 'claude-sonnet-5');

-- The other workspace's alias is deliberately **unbound and switched off** (V019): it needs
-- no connection of its own, and it is also the fixture for *a suspended alias is still a
-- referenced alias* — `enabled` is how a model is taken out of service, and taking one out
-- of service must not be a way past the delete guard.
insert into ouroboros.model_aliases
    (id, organization_id, alias, provider_connection_id, model_id, enabled) values
  ('f410000f-0000-0000-0000-00000000000f', 'org-refs-other', 'coder-max',
   null, 'claude-fable-5', false);

insert into ouroboros.task_kinds (id, organization_id, name, description, sort_order) values
  ('f4200000-0000-0000-0000-000000000001', 'org-refs', 'implement', 'Writes the code',  1),
  ('f4200000-0000-0000-0000-000000000002', 'org-refs', 'plan',      'Attack plan',      2),
  ('f4200000-0000-0000-0000-000000000003', 'org-refs', 'review',    'Self review',      3),
  ('f420000f-0000-0000-0000-00000000000f', 'org-refs-other', 'implement', 'Writes the code', 1);

insert into ouroboros.routes (id, organization_id, task_kind_id, tag) values
  ('f4300000-0000-0000-0000-000000000001', 'org-refs', 'f4200000-0000-0000-0000-000000000001', 'implement-primary'),
  ('f4300000-0000-0000-0000-000000000002', 'org-refs', 'f4200000-0000-0000-0000-000000000002', 'plan-primary'),
  ('f4300000-0000-0000-0000-000000000003', 'org-refs', 'f4200000-0000-0000-0000-000000000003', 'review-primary'),
  ('f430000f-0000-0000-0000-00000000000f', 'org-refs-other', 'f420000f-0000-0000-0000-00000000000f', 'implement-primary');

-- Three chains naming `coder-max` first, and a fallback naming `coder-std` — the mockup's
-- three route chips, plus a fourth reference that must not appear among them.
insert into ouroboros.route_hops (id, organization_id, route_id, position, model_alias_id) values
  ('f4400000-0000-0000-0000-000000000001', 'org-refs', 'f4300000-0000-0000-0000-000000000001', 1, 'f4100000-0000-0000-0000-000000000001'),
  ('f4400000-0000-0000-0000-000000000002', 'org-refs', 'f4300000-0000-0000-0000-000000000001', 2, 'f4100000-0000-0000-0000-000000000004'),
  ('f4400000-0000-0000-0000-000000000003', 'org-refs', 'f4300000-0000-0000-0000-000000000002', 1, 'f4100000-0000-0000-0000-000000000001'),
  ('f4400000-0000-0000-0000-000000000004', 'org-refs', 'f4300000-0000-0000-0000-000000000003', 1, 'f4100000-0000-0000-0000-000000000001'),
  ('f440000f-0000-0000-0000-00000000000f', 'org-refs-other', 'f430000f-0000-0000-0000-00000000000f', 1, 'f410000f-0000-0000-0000-00000000000f');

-- Four rules, chosen so that every shape the escalation leg has to cope with is present: a
-- `use_alias` target (the mockup's own rule), an `add_vote` target, a `route_local` that
-- targets nothing at all, and a **disabled** rule with a two-condition predicate.
insert into ouroboros.escalation_rules (id, organization_id, enabled, sort_order, "when", "then") values
  ('f4500000-0000-0000-0000-000000000001', 'org-refs', true, 1,
   '{"effort_gte": "l"}',
   '{"use_alias": {"task_kind": "implement", "alias": "coder-max", "params": {"thinking": "max"}}}'),
  ('f4500000-0000-0000-0000-000000000002', 'org-refs', true, 2,
   '{"label": "security"}',
   '{"add_vote": {"task_kind": "review", "alias": "second-opinion"}}'),
  ('f4500000-0000-0000-0000-000000000003', 'org-refs', true, 3,
   '{"diff_kind": "docs_only"}',
   '{"route_local": {}}'),
  ('f4500000-0000-0000-0000-000000000004', 'org-refs', false, 4,
   '{"effort_gte": "xl", "label": "urgent"}',
   '{"use_alias": {"task_kind": "plan", "alias": "coder-std"}}');

set constraints ouroboros.escalation_rules_targets_exist immediate;
set constraints ouroboros.escalation_rules_targets_exist deferred;

-- --- the mockup's four chips, exactly ------------------------------------------
--
-- Acceptance criterion: *`alias_references('coder-max')` returns the mockup's four chips
-- exactly — three route labels and the escalation label — and nothing else*. Asserted as the
-- whole ordered list rather than as a count, because a count is satisfied by four of the
-- wrong rows, and `ref_label` is the chip verbatim rather than something a caller assembles.
select pg_temp.must_hold(
  (select array_agg(ref_label order by kind, ref_label)
            = array['escalation:effort≥L', 'implement-primary', 'plan-primary', 'review-primary']
     from ouroboros.alias_references
    where organization_id = 'org-refs' and alias = 'coder-max'),
  'coder-max reads back the inspector''s four chips, in the mockup''s words and nothing else');

select pg_temp.must_hold(
  (select count(*) filter (where kind = 'route') = 3
      and count(*) filter (where kind = 'escalation') = 1
      and bool_and(blocking)
     from ouroboros.alias_references
    where organization_id = 'org-refs' and alias = 'coder-max'),
  'and they are three routes and one rule, every one of them blocking');

-- `ref_id` is the referring row rather than a label a chip was built from, which is what
-- makes a chip a destination CH.1 (#584) can link to.
select pg_temp.must_hold(
  (select bool_and(exists (select 1 from ouroboros.route_hops h where h.id = r.ref_id))
     from ouroboros.alias_references r
    where r.organization_id = 'org-refs' and r.alias = 'coder-max' and r.kind = 'route'),
  'a route reference names the hop it came from');

select pg_temp.must_hold(
  (select ref_id = 'f4500000-0000-0000-0000-000000000001'
     from ouroboros.alias_references
    where organization_id = 'org-refs' and alias = 'coder-max' and kind = 'escalation'),
  'and an escalation reference names the rule it came from');

-- --- counts are computed, and the zero is a count rather than an absence --------
--
-- Acceptance criterion: *counts match the `Used by` column, including the `0 routes` rows*.
-- The left join is the whole mechanism — the view has no row for an unreferenced alias, and
-- an alias with no row must still read `0` rather than drop out of the table.
select pg_temp.must_hold(
  (select array_agg(counted.line order by counted.line)
            = array['coder-max=4', 'coder-std=2', 'local-free=0', 'second-opinion=1']
     from (select a.alias || '=' || count(r.ref_id) as line
             from ouroboros.model_aliases a
             left join ouroboros.alias_references r on r.alias_id = a.id
            where a.organization_id = 'org-refs'
            group by a.alias) counted),
  'every alias in the workspace reads a computed Used by count, the unreferenced one included');

-- --- and it grants no read the tables under it would not ------------------------
select pg_temp.must_hold(
  (select reloptions @> array['security_invoker=true'] from pg_class
    where oid = 'ouroboros.alias_references'::regclass),
  'alias_references is security_invoker, so publishing the definition grants nobody a read they did not have');

-- --- the two legs that have no storage yet -------------------------------------
--
-- Acceptance criterion: *the chat-pin leg yields zero rows (not an error) while BZ.3 storage
-- is absent*. The same holds for the workflow leg until #132 and #133 land — see the
-- migration header for the `create or replace view` that adds each.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.alias_references
    where kind in ('workflow', 'chat_pin')),
  'the workflow and chat-pin legs contribute zero rows rather than an error while their storage is absent');

select pg_temp.must_hold(
  (select array['route', 'escalation', 'workflow', 'chat_pin']::ouroboros.alias_reference_kind[]
            is not null),
  'and all four kinds are already in the vocabulary, so the output shape does not change when they arrive');

select pg_temp.must_reject(
  $$select 'chat_ping'::ouroboros.alias_reference_kind$$,
  'a fifth reference kind is a migration rather than a string somebody typed into the union',
  'alias_reference_kind_known');

-- --- a rule that targets nothing references nothing ----------------------------
select pg_temp.must_hold(
  ouroboros.escalation_rule_alias('{"route_local": {}}'::jsonb) is null,
  'route_local names no alias, so the expression the index is built on answers null');

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.alias_references
    where organization_id = 'org-refs' and ref_id = 'f4500000-0000-0000-0000-000000000003'),
  'and the rule that carries it appears in no alias''s references');

-- --- a suspended rule is still a reference -------------------------------------
--
-- `enabled` is how a workspace suspends a rule without deleting it (V018). A view that
-- filtered on it would report a delete as safe that V018's trigger is about to refuse — and
-- would silently break the rule on the day somebody switched it back on.
select pg_temp.must_hold(
  (select array_agg(ref_label order by kind, ref_label)
            = array['escalation:effort≥XL and urgent label', 'implement-primary']
     from ouroboros.alias_references
    where organization_id = 'org-refs' and alias = 'coder-std'),
  'a disabled escalation rule is still a reference, and its chip renders both its conditions');

-- --- and so is an alias that is switched off -----------------------------------
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.alias_references
    where organization_id = 'org-refs-other' and alias = 'coder-max'),
  'switching an alias off does not unreference it — the switch is not a delete');

-- --- add_vote targets are found as reliably as use_alias ones -------------------
select pg_temp.must_hold(
  (select array_agg(ref_label) = array['escalation:security label']
     from ouroboros.alias_references
    where organization_id = 'org-refs' and alias = 'second-opinion'),
  'an alias only an add_vote rule names is referenced by it, with no route among its chips');

-- --- the chip cannot drift from the sentence -----------------------------------
--
-- The one real cost of rendering the predicate twice — V018's `display` backs a stored
-- generated column and cannot be refactored into a shared clause renderer, so the chip is a
-- second derivation of the same grammar. This is what stops the two diverging: over every
-- rule above, and therefore over every condition key the grammar has, the chip is the
-- sentence's predicate half with the comparison closed up. A wording change made in one
-- function and not the other goes red here.
select pg_temp.must_hold(
  (select bool_and(ouroboros.escalation_reference_label("when")
                     = 'escalation:' || replace(split_part(display, ' → ', 1), ' ≥ ', '≥'))
     from ouroboros.escalation_rules where organization_id = 'org-refs'),
  'every rule''s chip is its generated sentence''s predicate half, so the two renderings cannot drift');

-- --- one workspace's references are its own ------------------------------------
--
-- Both workspaces have an alias called `coder-max` — aliases are unique *per workspace*, so
-- this is the ordinary case rather than a contrived one, and it is the case a leg that
-- joined on name alone would get wrong.
select pg_temp.must_hold(
  (select bool_and(r.organization_id = a.organization_id)
     from ouroboros.alias_references r
     join ouroboros.model_aliases a on a.id = r.alias_id),
  'every reference and the alias it is about belong to the same workspace');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.alias_references
    where organization_id = 'org-refs-other' and alias = 'coder-max'
      and alias_id = 'f410000f-0000-0000-0000-00000000000f'),
  'the other workspace''s coder-max carries its own single reference and none of this one''s');

-- --- the guard answers what the view does, under a workspace it is given --------
select pg_temp.must_hold(
  (select array_agg(ref_label order by kind, ref_label)
     from ouroboros.alias_reference_guard('org-refs', 'f4100000-0000-0000-0000-000000000001'))
  = (select array_agg(ref_label order by kind, ref_label)
       from ouroboros.alias_references
      where organization_id = 'org-refs' and alias_id = 'f4100000-0000-0000-0000-000000000001'),
  'the guard returns exactly what the view does — the lock is all it adds');

select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.alias_reference_guard('org-refs', 'f410000f-0000-0000-0000-00000000000f')),
  'an alias belonging to another workspace is not this workspace''s to guard, and is not an error either');

select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.alias_reference_guard('org-refs', 'f4100000-0000-0000-0000-0000000000ff')),
  'and an alias that does not exist locks nothing and returns nothing');

select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.alias_reference_guard('org-refs', 'f4100000-0000-0000-0000-000000000003')),
  'the unreferenced alias is the one the guard clears — which is what makes a delete possible at all');

-- --- what the guard is for: both refusals, from both reference shapes ----------
--
-- The reference the database can declare, and the one it cannot. A hop is a foreign key and
-- refuses immediately; a rule's target is a name inside jsonb and refuses at V018's deferred
-- trigger, asked for early here so the refusal is visible inside this transaction.
select pg_temp.must_reject(
  $$delete from ouroboros.model_aliases
     where organization_id = 'org-refs' and alias = 'coder-max'$$,
  'an alias a route hop names cannot be deleted — the blocked Remove state, at the database',
  'route_hops_alias_fk');

select pg_temp.must_reject(
  $$delete from ouroboros.model_aliases
     where organization_id = 'org-refs' and alias = 'second-opinion';
    set constraints ouroboros.model_aliases_escalation_targets_exist immediate$$,
  'and an alias only a rule names cannot be deleted either, though no foreign key says so',
  'model_aliases_escalation_targets_exist');

-- Rename, which is the reason this view has to find name-based references as reliably as
-- foreign-key ones: a hop follows a rename because it holds an id, and a rule does not
-- because it holds a name.
select pg_temp.must_reject(
  $$update ouroboros.model_aliases set alias = 'coder-ultra'
     where organization_id = 'org-refs' and alias = 'coder-max';
    set constraints ouroboros.model_aliases_escalation_targets_exist immediate$$,
  'renaming an alias is guarded exactly like deleting one, because the by-name reference does not follow it',
  'model_aliases_escalation_targets_exist');

-- --- and it is one indexed pass, not a scan of every document ------------------
--
-- Acceptance criterion: *`Used by` for eight rows is one indexed pass rather than eight
-- document scans*. must_not_scan rather than must_use_index alone, because this plan has
-- five relations in it and naming one index proves nothing about the other four — see the
-- helper's own comment on why sequential scans are discouraged first.
set local enable_seqscan = off;

select pg_temp.must_not_scan(
  $$select * from ouroboros.alias_references
     where organization_id = 'org-refs' and alias = 'coder-max'$$);

select pg_temp.must_use_index(
  $$select * from ouroboros.alias_references
     where organization_id = 'org-refs' and alias = 'coder-max'$$,
  'route_hops_alias_idx');

-- The leg with no column to index. Without this index the escalation half of every `Used by`
-- cell reads every rule's `then` document; with it, a rule's target is a btree lookup.
select pg_temp.must_use_index(
  $$select * from ouroboros.alias_references
     where organization_id = 'org-refs' and alias = 'coder-max'$$,
  'escalation_rules_alias_idx');

set local enable_seqscan = on;

-- --- the workspace cascade -----------------------------------------------------
--
-- Every leg of the view hangs off tables that cascade with the workspace, so a deleted
-- workspace takes its references with it — and, worth asserting rather than assuming, the
-- delete is not refused by the guards above on its way out.
delete from ouroboros.organization where "id" = 'org-refs';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.alias_references where organization_id = 'org-refs'),
  'deleting a workspace takes its alias references with it, both guards notwithstanding');

delete from ouroboros.organization where "id" = 'org-refs-other';

-- ---------------------------------------------------------------------------
-- Nothing is kept. The database is exactly as it was found.
-- ---------------------------------------------------------------------------
rollback;

-- Except one thing, which is why it is put back here rather than trusted to the rollback.
--
-- The plan assertions above `analyze` two tables so the planner has statistics to choose
-- between two otherwise identically-priced index paths — see the V015 section for why that
-- is load-bearing. `ANALYZE` writes `pg_statistic` transactionally, and that much did go out
-- with the rollback; but it also writes `pg_class.reltuples` and `relpages` **in place**,
-- and an in-place update is not part of any transaction. Left alone it would leave both
-- tables claiming the row count they had *inside* the transaction, which is a count of
-- fixtures that no longer exist — so a second run of this file would plan differently from
-- the first, and a developer running it against a database they are using would leave it
-- describing itself wrongly until the next autovacuum.
--
-- Measuring them again now is the repair: the rollback has restored whatever those tables
-- really hold, and this records that. Empty in a CI database, and the truth in anybody
-- else's.
analyze ouroboros.model_aliases;
analyze ouroboros.provider_connections;

\o
\echo 'constraints.sql: all assertions passed'
