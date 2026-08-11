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
-- Covers V001 (#20), V002 (#21) and V003 (#22). A migration that adds a rule adds its
-- assertion here in the same change. What R__dev_seed.sql (#23) *puts* in a development
-- database is seed.sql beside this file; what the schema refuses to let anything put
-- there is here.

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
-- since #23, R__dev_seed.sql puts the demo tenant into every database the compose stack
-- migrates — and it is drawn from the same mockups these fixtures are, so it holds the
-- same slug, the same domain and the same email addresses.
--
-- Clearing is the fix rather than renaming the fixtures: a rename would leave the
-- absolute counts ("`count(*) = 3 from users`") quietly measuring the seed as well, and
-- would have to be done again the next time a seed grows into a name used here.
--
-- Nothing is lost. This is inside the transaction the end of the script rolls back, so
-- every row deleted here is restored on the way out — which is what keeps this safe to
-- run against a database somebody is using. Two deletes cover the schema: every other
-- table cascades from `tenants` or from `users`.
-- ---------------------------------------------------------------------------
delete from ouroboros.tenants;
delete from ouroboros.users;

-- ---------------------------------------------------------------------------
-- Fixtures. Fixed uuids so an assertion can name a row without a lookup.
-- ---------------------------------------------------------------------------
insert into ouroboros.tenants (id, slug, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'acme-robotics', 'Acme Robotics'),
  ('22222222-2222-2222-2222-222222222222', 'globex',        'Globex');

insert into ouroboros.tenant_domains (tenant_id, domain, is_primary) values
  ('11111111-1111-1111-1111-111111111111', 'acme-robotics.dev', true),
  ('11111111-1111-1111-1111-111111111111', 'acme.example',      false);

-- Three people, one of whom belongs to both tenants — the acceptance criterion about
-- multiple tenancies is asserted against this pairing rather than a row made for it.
-- `aaaa…` is a throwaway whose deletion is what the user-cascade assertions observe.
insert into ouroboros.users (id, email, display_name, avatar_url) values
  ('66666666-6666-6666-6666-666666666666', 'ken@acme-robotics.dev',   'Ken S',       'https://avatars.example/ken.png'),
  ('77777777-7777-7777-7777-777777777777', 'maya@acme-robotics.dev',  'Maya Chen',   null),
  ('88888888-8888-8888-8888-888888888888', 'jorge@globex.example',    'Jorge Reyes', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'temp@acme-robotics.dev',  'Temp Person', null);

insert into ouroboros.user_identities (user_id, provider, external_id) values
  ('66666666-6666-6666-6666-666666666666', 'github', '1001'),
  ('77777777-7777-7777-7777-777777777777', 'github', '1002'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'github', '1003');

insert into ouroboros.tenant_members (tenant_id, user_id, role, joined_at) values
  ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', 'owner',  now()),
  ('11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777', 'admin',  null),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'viewer', now()),
  ('22222222-2222-2222-2222-222222222222', '66666666-6666-6666-6666-666666666666', 'viewer', now()),
  ('22222222-2222-2222-2222-222222222222', '88888888-8888-8888-8888-888888888888', 'member', now());

insert into ouroboros.github_orgs (id, tenant_id, login, enabled) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'acme-robotics', true),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'globex-inc',    false);

insert into ouroboros.github_repos (org_id, name, enabled, default_branch) values
  ('33333333-3333-3333-3333-333333333333', 'helios-firmware', true,  'main'),
  ('33333333-3333-3333-3333-333333333333', 'atlas-control',   false, null);

-- ===========================================================================
-- V001 — tenants & domains (#20)
-- ===========================================================================

-- Status is constrained, not free text.
select pg_temp.must_reject(
  $$insert into ouroboros.tenants (slug, display_name, status)
    values ('bad-status', 'Bad Status', 'archived')$$,
  'tenants.status rejects a value outside active|suspended|deleted', 'tenants_status_valid');

select pg_temp.must_hold(
  (select count(*) = 3 from (values ('active'), ('suspended'), ('deleted')) as v(s)
   where exists (select 1 where v.s in ('active', 'suspended', 'deleted'))),
  'the three documented statuses are the accepted set');

-- Slugs are unique across the installation.
select pg_temp.must_reject(
  $$insert into ouroboros.tenants (slug, display_name) values ('acme-robotics', 'Impostor')$$,
  'tenants.slug is unique', 'tenants_slug_key');

-- A duplicate domain across tenants is rejected — a domain resolves one tenant.
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_domains (tenant_id, domain)
    values ('22222222-2222-2222-2222-222222222222', 'acme-robotics.dev')$$,
  'tenant_domains.domain is unique across tenants', 'tenant_domains_domain_key');

-- Domains are stored folded, so the unique index is also the case-insensitive rule.
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_domains (tenant_id, domain)
    values ('22222222-2222-2222-2222-222222222222', 'Globex.Example')$$,
  'tenant_domains.domain must be stored lower-cased', 'tenant_domains_domain_format');

-- One primary domain per tenant, and zero is legal.
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_domains (tenant_id, domain, is_primary)
    values ('11111111-1111-1111-1111-111111111111', 'acme-second.example', true)$$,
  'at most one primary domain per tenant', 'tenant_domains_one_primary_per_tenant');

insert into ouroboros.tenant_domains (tenant_id, domain, is_primary)
  values ('22222222-2222-2222-2222-222222222222', 'globex.example', false);
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.tenant_domains
   where tenant_id = '22222222-2222-2222-2222-222222222222' and is_primary),
  'a tenant with no primary domain is representable');

-- Sign-in resolves the tenant by domain, on every sign-in — it must not be a scan.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select tenant_id from ouroboros.tenant_domains where domain = lower('Acme-Robotics.dev')$$,
  'tenant_domains_domain_key');
set local enable_seqscan = on;

-- updated_at is maintained by the trigger, and the server clock wins over the statement.
--
-- Backdated first, because `now()` is the *transaction* timestamp: every default and
-- every trigger firing in this script sees the same instant, so a freshly inserted row
-- has updated_at = created_at and no update inside this transaction can make one exceed
-- the other. Starting from a stale value is what makes the trigger's effect visible —
-- and it is the stronger assertion anyway, since it also proves the trigger overrides a
-- value the statement supplied rather than merely filling in an absent one.
update ouroboros.tenants set updated_at = '2000-01-01T00:00:00Z'
  where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.must_hold(
  (select updated_at >= created_at from ouroboros.tenants
   where id = '11111111-1111-1111-1111-111111111111'),
  'tenants.updated_at ignores a stale value supplied by the statement');

select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.tenants
   where id = '11111111-1111-1111-1111-111111111111'),
  'tenants.updated_at is stamped from the server clock by its touch trigger');

-- ===========================================================================
-- V002 — users, identities & tenant membership (#21)
-- ===========================================================================

-- --- users -----------------------------------------------------------------

-- One address is one human: a second row carrying it would put one person twice into
-- the member list, with two independent sets of roles.
select pg_temp.must_reject(
  $$insert into ouroboros.users (email, display_name)
    values ('ken@acme-robotics.dev', 'Impostor')$$,
  'users.email is unique across the installation', 'users_email_key');

-- Folded on the way in, so the unique index above is the case-insensitive rule too.
-- Unlike V001's domain and V003's login, the format check below cannot enforce this on
-- its own — an address may contain almost any character — so the folding has a
-- constraint of its own, and this asserts it is that one which fires.
select pg_temp.must_reject(
  $$insert into ouroboros.users (email, display_name)
    values ('Ken@Acme-Robotics.dev', 'Ken Again')$$,
  'users.email must be stored lower-cased', 'users_email_lowercase');

select pg_temp.must_reject(
  $$insert into ouroboros.users (email, display_name) values ('not an address', 'Nobody')$$,
  'users.email rejects a value that is not an address', 'users_email_format');

select pg_temp.must_reject(
  $$insert into ouroboros.users (email, display_name) values ('blank@example.com', '   ')$$,
  'users.display_name rejects blank text', 'users_display_name_present');

-- avatar_url reaches the UI as an image source, so the shapes that matter are the ones
-- that are not images.
select pg_temp.must_reject(
  $$insert into ouroboros.users (email, display_name, avatar_url)
    values ('xss@example.com', 'Payload', 'javascript:alert(1)')$$,
  'users.avatar_url rejects a non-http(s) scheme', 'users_avatar_url_format');
select pg_temp.must_reject(
  $$insert into ouroboros.users (email, display_name, avatar_url)
    values ('data@example.com', 'Payload', 'data:text/html;base64,PHNjcmlwdD4=')$$,
  'users.avatar_url rejects a data: URL', 'users_avatar_url_format');
select pg_temp.must_reject(
  $$insert into ouroboros.users (email, display_name, avatar_url)
    values ('space@example.com', 'Payload', 'https://avatars.example/a.png" onerror="x')$$,
  'users.avatar_url rejects whitespace that could carry a second attribute',
  'users_avatar_url_format');

select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.users
   where email in ('ken@acme-robotics.dev', 'maya@acme-robotics.dev')
     and (avatar_url is null or avatar_url like 'https://%')),
  'users.avatar_url accepts an https URL and accepts null');

-- --- user_identities -------------------------------------------------------

-- Acceptance criterion: the same GitHub identity cannot attach to two users.
select pg_temp.must_reject(
  $$insert into ouroboros.user_identities (user_id, provider, external_id)
    values ('88888888-8888-8888-8888-888888888888', 'github', '1001')$$,
  'the same GitHub identity cannot attach to two users',
  'user_identities_provider_external_id_key');

-- …nor twice to the same one.
select pg_temp.must_reject(
  $$insert into ouroboros.user_identities (user_id, provider, external_id)
    values ('66666666-6666-6666-6666-666666666666', 'github', '1001')$$,
  'the same GitHub identity cannot be attached twice to one user',
  'user_identities_provider_external_id_key');

-- But one person may link two GitHub accounts: (user_id, provider) is deliberately not
-- unique, and this is the assertion that would fail if someone made it so.
insert into ouroboros.user_identities (user_id, provider, external_id)
  values ('66666666-6666-6666-6666-666666666666', 'github', '2001');
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.user_identities
   where user_id = '66666666-6666-6666-6666-666666666666'),
  'one user may hold two identities from the same provider');

select pg_temp.must_reject(
  $$insert into ouroboros.user_identities (user_id, provider, external_id)
    values ('88888888-8888-8888-8888-888888888888', 'gitlab', '1')$$,
  'user_identities.provider rejects a provider outside the accepted set',
  'user_identities_provider_valid');

select pg_temp.must_reject(
  $$insert into ouroboros.user_identities (user_id, provider, external_id)
    values ('88888888-8888-8888-8888-888888888888', 'github', '10 04')$$,
  'user_identities.external_id rejects whitespace', 'user_identities_external_id_format');
select pg_temp.must_reject(
  $$insert into ouroboros.user_identities (user_id, provider, external_id)
    values ('88888888-8888-8888-8888-888888888888', 'github', '')$$,
  'user_identities.external_id rejects the empty string', 'user_identities_external_id_format');

select pg_temp.must_reject(
  $$insert into ouroboros.user_identities (user_id, provider, external_id)
    values ('99999999-9999-9999-9999-999999999999', 'github', '9001')$$,
  'user_identities.user_id references an existing user', 'user_identities_user_id_fkey');

-- --- tenant_members --------------------------------------------------------

-- Acceptance criterion: the same user cannot join a tenant twice. The pair is the
-- primary key, so this is true by construction rather than by a droppable rule.
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_members (tenant_id, user_id, role)
    values ('11111111-1111-1111-1111-111111111111',
            '66666666-6666-6666-6666-666666666666', 'viewer')$$,
  'the same user cannot join a tenant twice', 'tenant_members_pkey');

-- Acceptance criterion: a user may belong to multiple tenants with different roles.
select pg_temp.must_hold(
  (select count(distinct role) = 2 and count(*) = 2 from ouroboros.tenant_members
   where user_id = '66666666-6666-6666-6666-666666666666'),
  'one user belongs to two tenants holding a different role in each');

select pg_temp.must_reject(
  $$insert into ouroboros.tenant_members (tenant_id, user_id, role)
    values ('22222222-2222-2222-2222-222222222222',
            '77777777-7777-7777-7777-777777777777', 'maintainer')$$,
  'tenant_members.role rejects a value outside owner|admin|member|viewer',
  'tenant_members_role_valid');

select pg_temp.must_hold(
  (select count(*) = 4 from (values ('owner'), ('admin'), ('member'), ('viewer')) as v(r)
   where exists (select 1 where v.r in ('owner', 'admin', 'member', 'viewer'))),
  'the four documented roles are the accepted set');

-- The role has no default: omitting it is a not-null violation, not a silent grant.
-- Left unpinned because PostgreSQL raises a not-null violation with no constraint name
-- to match against — the class (23, integrity constraint) is what must_reject checks.
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_members (tenant_id, user_id)
    values ('22222222-2222-2222-2222-222222222222',
            '77777777-7777-7777-7777-777777777777')$$,
  'tenant_members.role has no default — an omitted role is refused');

-- An outstanding invitation is a real state the member list renders.
select pg_temp.must_hold(
  (select joined_at is null from ouroboros.tenant_members
   where tenant_id = '11111111-1111-1111-1111-111111111111'
     and user_id = '77777777-7777-7777-7777-777777777777'),
  'a membership with joined_at null represents an outstanding invitation');

select pg_temp.must_reject(
  $$insert into ouroboros.tenant_members (tenant_id, user_id, role, invited_at, joined_at)
    values ('22222222-2222-2222-2222-222222222222',
            '77777777-7777-7777-7777-777777777777', 'member',
            now(), now() - interval '1 day')$$,
  'tenant_members rejects an acceptance that precedes the invitation',
  'tenant_members_joined_after_invited');

select pg_temp.must_reject(
  $$insert into ouroboros.tenant_members (tenant_id, user_id, role)
    values ('99999999-9999-9999-9999-999999999999',
            '66666666-6666-6666-6666-666666666666', 'member')$$,
  'tenant_members.tenant_id references an existing tenant', 'tenant_members_tenant_id_fkey');
select pg_temp.must_reject(
  $$insert into ouroboros.tenant_members (tenant_id, user_id, role)
    values ('22222222-2222-2222-2222-222222222222',
            '99999999-9999-9999-9999-999999999999', 'member')$$,
  'tenant_members.user_id references an existing user', 'tenant_members_user_id_fkey');

-- --- no credentials, asserted rather than trusted ---------------------------
--
-- Acceptance criterion: no OAuth tokens are stored in this schema. Read from the
-- catalogue so the check keeps holding against a column added later, which a fixed list
-- of expected columns would not — a new `github_access_token` would simply not be
-- mentioned by it.
select pg_temp.must_hold(
  (select count(*) = 0 from information_schema.columns
   where table_schema = 'ouroboros'
     and table_name in ('users', 'user_identities', 'tenant_members')
     and column_name ~ '(token|secret|credential|password|passwd|_key$)'),
  'V002 stores no token, secret or credential column');

-- --- indexes ---------------------------------------------------------------
--
-- The four reads that happen on every sign-in and on every member list. As in V001,
-- what is asserted is that a usable index exists, not that the planner prefers it at
-- fixture size.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select id from ouroboros.users where email = lower('Ken@Acme-Robotics.dev')$$,
  'users_email_key');
select pg_temp.must_use_index(
  $$select user_id from ouroboros.user_identities
    where provider = 'github' and external_id = '1001'$$,
  'user_identities_provider_external_id_key');
select pg_temp.must_use_index(
  $$select id from ouroboros.user_identities
    where user_id = '66666666-6666-6666-6666-666666666666'$$,
  'user_identities_user_id_idx');
select pg_temp.must_use_index(
  $$select role from ouroboros.tenant_members
    where tenant_id = '11111111-1111-1111-1111-111111111111'$$,
  'tenant_members_pkey');
select pg_temp.must_use_index(
  $$select tenant_id from ouroboros.tenant_members
    where user_id = '66666666-6666-6666-6666-666666666666'$$,
  'tenant_members_user_id_idx');
set local enable_seqscan = on;

-- --- triggers --------------------------------------------------------------
--
-- All three tables share V001's function, so all three are checked. Backdated first,
-- for the reason the V001 block gives.
update ouroboros.users set updated_at = '2000-01-01T00:00:00Z'
  where id = '66666666-6666-6666-6666-666666666666';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.users
   where id = '66666666-6666-6666-6666-666666666666'),
  'users.updated_at is stamped by its touch trigger');

update ouroboros.user_identities set updated_at = '2000-01-01T00:00:00Z'
  where provider = 'github' and external_id = '1001';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.user_identities
   where provider = 'github' and external_id = '1001'),
  'user_identities.updated_at is stamped by its touch trigger');

update ouroboros.tenant_members set updated_at = '2000-01-01T00:00:00Z'
  where tenant_id = '11111111-1111-1111-1111-111111111111'
    and user_id = '66666666-6666-6666-6666-666666666666';
select pg_temp.must_hold(
  (select updated_at = now() from ouroboros.tenant_members
   where tenant_id = '11111111-1111-1111-1111-111111111111'
     and user_id = '66666666-6666-6666-6666-666666666666'),
  'tenant_members.updated_at is stamped by its touch trigger');

-- --- deleting a person ------------------------------------------------------
--
-- Both of the user's dependents go with them. The identity cascade is load-bearing
-- rather than tidy: an orphaned row would hold its (provider, external_id) pair against
-- the unique key, and that GitHub account could never sign in again.
delete from ouroboros.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.user_identities
   where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'deleting a user cascades to their user_identities');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.tenant_members
   where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'deleting a user cascades to their tenant_members');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenants
   where id = '11111111-1111-1111-1111-111111111111'),
  'deleting a user does not delete the tenants they belonged to');
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.tenant_members
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  'deleting one member leaves the tenant''s other memberships alone');

-- ===========================================================================
-- V003 — GitHub org & repo enablement (#22)
-- ===========================================================================

-- Acceptance criterion: unique org per tenant.
select pg_temp.must_reject(
  $$insert into ouroboros.github_orgs (tenant_id, login)
    values ('11111111-1111-1111-1111-111111111111', 'acme-robotics')$$,
  'github_orgs.login is unique within a tenant', 'github_orgs_tenant_login_key');

-- Scoped per tenant, not globally — two tenants may each enable the same org.
insert into ouroboros.github_orgs (tenant_id, login)
  values ('22222222-2222-2222-2222-222222222222', 'acme-robotics');
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.github_orgs where login = 'acme-robotics'),
  'the same org login may be enabled by two different tenants');

-- Logins are folded, so the unique key is case-insensitive in effect.
select pg_temp.must_reject(
  $$insert into ouroboros.github_orgs (tenant_id, login)
    values ('11111111-1111-1111-1111-111111111111', 'Acme-Robotics')$$,
  'github_orgs.login must be stored lower-cased', 'github_orgs_login_format');

-- An org must belong to a tenant that exists.
select pg_temp.must_reject(
  $$insert into ouroboros.github_orgs (tenant_id, login)
    values ('99999999-9999-9999-9999-999999999999', 'orphan-org')$$,
  'github_orgs.tenant_id references an existing tenant', 'github_orgs_tenant_id_fkey');

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
insert into ouroboros.github_orgs (id, tenant_id, login)
  values ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'defaults-org');
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
   where o.tenant_id = '11111111-1111-1111-1111-111111111111'
     and o.enabled and r.enabled),
  'scope is the intersection of the org flag and the repo flag');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_repos r
     join ouroboros.github_orgs o on o.id = r.org_id
   where o.id = '44444444-4444-4444-4444-444444444444' and not o.enabled),
  'a disabled org keeps its repo rows rather than discarding them');

-- Both V003 tables carry the same touch trigger as V001's, sharing one function.
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

-- Listing a tenant's orgs, and an org's repos, must not be condemned to a scan either;
-- both are served by the leading column of their unique key rather than a second index.
set local enable_seqscan = off;
select pg_temp.must_use_index(
  $$select id from ouroboros.github_orgs where tenant_id = '11111111-1111-1111-1111-111111111111'$$,
  'github_orgs_tenant_login_key');
select pg_temp.must_use_index(
  $$select id from ouroboros.github_repos where org_id = '33333333-3333-3333-3333-333333333333'$$,
  'github_repos_org_name_key');
set local enable_seqscan = on;

-- Acceptance criterion: cascading delete tenant → orgs → repos.
delete from ouroboros.tenants where id = '11111111-1111-1111-1111-111111111111';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_orgs
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  'deleting a tenant cascades to its github_orgs');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_repos
   where org_id = '33333333-3333-3333-3333-333333333333'),
  'deleting a tenant cascades through its orgs to their github_repos');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.tenant_domains
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  'deleting a tenant cascades to its tenant_domains');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.tenant_members
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  'deleting a tenant cascades to its tenant_members');

-- …but not to the people. A membership is a pairing; removing the workspace removes the
-- pairing, and the human survives to hold their roles in whatever tenants remain.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.users),
  'deleting a tenant does not delete its members');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_members
   where user_id = '66666666-6666-6666-6666-666666666666'),
  'a user in two tenants keeps their membership of the tenant that remains');

-- The other tenant is untouched — the cascade is scoped, not a table sweep.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.github_orgs
   where tenant_id = '22222222-2222-2222-2222-222222222222'),
  'deleting one tenant leaves another tenant''s orgs alone');

-- Deleting an org cascades to its repos without touching the tenant.
delete from ouroboros.github_orgs where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.github_repos
   where org_id = '44444444-4444-4444-4444-444444444444'),
  'deleting an org cascades to its github_repos');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenants
   where id = '22222222-2222-2222-2222-222222222222'),
  'deleting an org does not delete its tenant');

-- ---------------------------------------------------------------------------
-- Nothing is kept. The database is exactly as it was found.
-- ---------------------------------------------------------------------------
rollback;

\o
\echo 'constraints.sql: all assertions passed'
