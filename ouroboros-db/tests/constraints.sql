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

-- ---------------------------------------------------------------------------
-- Nothing is kept. The database is exactly as it was found.
-- ---------------------------------------------------------------------------
rollback;

\o
\echo 'constraints.sql: all assertions passed'
