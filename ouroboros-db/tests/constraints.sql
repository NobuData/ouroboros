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
-- The three product tables added since stand on that base and have a section each:
-- `user_preferences` (V007, #649), `runs` (V008, #64) and `queue_items` (V009, #65).
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

-- ---------------------------------------------------------------------------
-- Nothing is kept. The database is exactly as it was found.
-- ---------------------------------------------------------------------------
rollback;

\o
\echo 'constraints.sql: all assertions passed'
