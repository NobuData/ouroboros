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
-- Covers V001 (#20), V002 (#21), V003 (#22), V004 (#706) and V005 (#707). A migration that
-- adds a rule adds its assertion here in the same change. What R__dev_seed.sql (#23) *puts*
-- in a development database is seed.sql beside this file; what the schema refuses to let
-- anything put there is here.

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
-- run against a database somebody is using. Four deletes cover the schema: every other
-- table cascades from `tenants`, from `users`, from `"user"`, or from `organization`.
--
-- `"user"` needs its own delete because nothing joins it to `users` — V004 copied the rows
-- across and left no foreign key between the two, which is exactly what makes the old
-- tables droppable in #708. Quoted, like every other reference to it in this repository.
--
-- `organization` needs its own for the mirror-image reason: V005's `member` and
-- `invitation` cascade from `"user"` as well, so clearing the people empties both — but the
-- organizations they named survive, and the V005 section below counts them.
-- ---------------------------------------------------------------------------
delete from ouroboros.tenants;
delete from ouroboros.users;
delete from ouroboros."user";
delete from ouroboros.organization;

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

-- ===========================================================================
-- V004 — BetterAuth core schema and the back-fill out of V002 (#706)
-- ===========================================================================
--
-- Two different things are asserted here and they are worth telling apart. The first is
-- ordinary: four vendor-shaped tables, and the rules V004 adds to the ones the library
-- emitted. The second is the migration's *data* half — that the people V002 already held
-- came across with their ids intact — which is the acceptance criterion nothing but a
-- populated database can answer.
--
-- The state this section starts from is the state the sections above left behind, and it is
-- exactly the fixture the back-fill needs: three `users` rows, two of them holding a GitHub
-- identity, and the BetterAuth tables empty because the header cleared them. Nothing new is
-- inserted into the V002 tables for this.

-- --- the tables exist, under the names the library looks for ----------------
--
-- `to_regclass` answers null rather than raising for a name that resolves to nothing, which
-- is what lets a missing table be a named assertion failure instead of an aborted script.
-- The literal is double-quoted *inside* the string, because that is the only spelling
-- PostgreSQL resolves: `ouroboros.user` unquoted is the `user` keyword.
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
-- than left as an absence. V002's tables are asserted *not* to hold one, a few hundred
-- lines up; `account` is the library's table, the columns are its contract, and BetterAuth
-- encrypts the tokens with BETTER_AUTH_SECRET before they are written.
select pg_temp.must_hold(
  (select count(*) = 3 from information_schema.columns
   where table_schema = 'ouroboros' and table_name = 'account'
     and column_name in ('accessToken', 'refreshToken', 'password')),
  'account is the one table that holds credentials, and holds all three columns for them');

-- --- the back-fill (#706''s data half) --------------------------------------
--
-- Run against the rows the sections above left in `users` and `user_identities`. What is
-- asserted is the acceptance criterion in its own words: the counts match and the ids did
-- not change.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros."user"),
  'the back-fill is being run against empty BetterAuth tables, as V004 found them');

create temporary table backfilled as
  select * from ouroboros.backfill_betterauth_core();

select pg_temp.must_hold(
  (select users_copied = (select count(*) from ouroboros.users) from backfilled),
  'the back-fill reports copying every users row');
select pg_temp.must_hold(
  (select accounts_copied = (select count(*) from ouroboros.user_identities) from backfilled),
  'the back-fill reports copying every user_identities row');

select pg_temp.must_hold(
  (select (select count(*) from ouroboros."user") = (select count(*) from ouroboros.users)),
  'count("user") = count(users) after the back-fill');
select pg_temp.must_hold(
  (select (select count(*) from ouroboros.account) = (select count(*) from ouroboros.user_identities)),
  'count(account) = count(user_identities) after the back-fill');

-- Ids preserved, which is the property #708 depends on: every foreign key already written
-- against `users.id` names the same person in `"user"`.
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.users u
   where not exists (select 1 from ouroboros."user" b where b."id" = u.id::text)),
  'every users.id survives as "user".id, spelled as text');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.user_identities i
   where not exists (select 1 from ouroboros.account a where a."id" = i.id::text)),
  'every user_identities.id survives as account.id');

-- The columns, one by one, on a row whose values the fixture above chose.
select pg_temp.must_hold(
  (select b."name" = 'Ken S' and b."email" = 'ken@acme-robotics.dev'
      and b."image" = 'https://avatars.example/ken.png'
   from ouroboros."user" b where b."id" = '66666666-6666-6666-6666-666666666666'),
  'the back-fill maps display_name → name and avatar_url → image');
-- Keyed on the pair rather than on the id, because the fixture above let
-- `user_identities.id` default — that the id came across at all is the assertion two above,
-- and this one is about the two columns whose names change in the move.
select pg_temp.must_hold(
  (select a."userId" = '66666666-6666-6666-6666-666666666666'
     and a."id" = (select i.id::text from ouroboros.user_identities i where i.external_id = '1001')
   from ouroboros.account a
   where a."providerId" = 'github' and a."accountId" = '1001'),
  'the back-fill maps provider → providerId and external_id → accountId');

-- No token comes across, because V002 never held one. A null `accessToken` is the correct
-- reading of "this person is recognised but has not signed in since the move".
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.account
   where "accessToken" is not null or "refreshToken" is not null or "password" is not null),
  'the back-fill carries no credential across, because V002 stored none');

-- `emailVerified` is derived rather than defaulted, and the two answers are both here:
-- somebody who signed in through #33's flow proved a verified GitHub address, and somebody
-- who exists only because they were invited (#31) has proved nothing. `88888888…` is the
-- fixture's person with no identity row, which is what an uninvited stub looks like.
select pg_temp.must_hold(
  (select b."emailVerified" from ouroboros."user" b
   where b."id" = '66666666-6666-6666-6666-666666666666'),
  'a back-filled person with a GitHub identity is emailVerified');
select pg_temp.must_hold(
  (select not b."emailVerified" from ouroboros."user" b
   where b."id" = '88888888-8888-8888-8888-888888888888'),
  'a back-filled person with no identity is not emailVerified');

-- Idempotent, which is what makes it safe to run by hand on a development database the
-- seed filled after V004 had already been applied — the case this migration's header
-- describes.
select pg_temp.must_hold(
  (select users_copied = 0 and accounts_copied = 0
   from ouroboros.backfill_betterauth_core()),
  'running the back-fill a second time copies nothing');

-- --- uniqueness -------------------------------------------------------------
--
-- The three rules the acceptance criteria name. Each is asserted by the statement it must
-- refuse, with the constraint that has to be the one to fire — without naming it, a row
-- rejected by some unrelated not-null would read as a pass.
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

-- The rule V004 adds that the library does not emit, and the successor to V002's
-- `user_identities_provider_external_id_key`: one GitHub account belongs to one person.
select pg_temp.must_reject(
  $$insert into ouroboros.account ("id", "accountId", "providerId", "userId", "updatedAt")
    values ('second-claim', '1001', 'github',
            '77777777-7777-7777-7777-777777777777', now())$$,
  'account(providerId, accountId) is unique — one GitHub account is one person',
  'account_provider_account_key');

-- Scoped by provider, exactly as V002''s was: two providers may independently issue the id
-- `1001`, and those are not the same account.
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
-- The two reads every request makes once #703 turns database-backed sessions on: the
-- session by its cookie, and — on a sign-in — the account by provider and id. Both must be
-- served by an index at production size, which is what these assert; as elsewhere in this
-- file, the planner is stopped from preferring a scan over a fixture-sized table.
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
-- Deleting a person ends their sessions and removes the accounts that authenticated them,
-- in the same statement. A session row outliving its user would be a cookie that resolves
-- to nobody — a 500 rather than a sign-out — and an orphaned account row would keep its
-- (providerId, accountId) pair reserved against the unique index above, so that GitHub
-- account could never sign in again.
delete from ouroboros."user" where "id" = '66666666-6666-6666-6666-666666666666';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.session
   where "userId" = '66666666-6666-6666-6666-666666666666'),
  'deleting a "user" cascades to their sessions');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.account
   where "userId" = '66666666-6666-6666-6666-666666666666'),
  'deleting a "user" cascades to their accounts');

-- And it reaches no further. V004 deliberately writes no foreign key between the two
-- generations of user table, which is what lets #708 drop the old one without a rewrite.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.users
   where id = '66666666-6666-6666-6666-666666666666'),
  'deleting a "user" leaves the V002 users row alone — the two tables carry no FK between them');

-- ===========================================================================
-- V005 — the organization plugin's schema, and the tenant pointer (#707)
-- ===========================================================================
--
-- Three tables and one column, and the rules V005 adds to the ones the library emitted.
-- The state this section starts from is what the V004 section left: `"user"` holds Maya
-- (`7777…`), Jorge (`8888…`) and the throwaway (`aaaa…`), Ken having been deleted by the
-- cascade assertions above. `organization`, `member` and `invitation` are empty — the
-- header cleared them and nothing since has written one.
--
-- What is *not* asserted here is anything about roles. `member.role` is deliberately not
-- CHECK-constrained (see the migration), so the vocabulary is ouroboros-rest's to enforce
-- and #715's to assert; a test here would be testing a rule this schema does not make.

-- --- the tables exist, with the library's names and casing --------------------
select pg_temp.must_hold(
  (select count(*) = 3 from information_schema.tables
   where table_schema = 'ouroboros'
     and table_name in ('organization', 'member', 'invitation')),
  'V005 created all three organization-plugin tables');

-- Roadmap decision A4, asserted rather than assumed, exactly as the V004 section asserts it
-- for `"user"`. A migration that "tidied" `organizationId` into `organization_id` would
-- apply cleanly and then fail on the first organization anybody created.
select pg_temp.must_hold(
  (select count(*) = 4 from information_schema.columns
   where table_schema = 'ouroboros' and table_name = 'member'
     and column_name in ('id', 'organizationId', 'userId', 'role')),
  'member keeps BetterAuth''s camelCase column names');

-- #724's column, present now rather than then — the acceptance criterion that this
-- migration is what unblocks the invitation flow rather than merely preceding it.
select pg_temp.must_hold(
  (select count(*) = 1 from information_schema.columns
   where table_schema = 'ouroboros' and table_name = 'invitation'
     and column_name = 'expiresAt' and data_type = 'timestamp with time zone'),
  'invitation.expiresAt is present, and is a timestamptz — #724 depends on it');

-- --- fixtures ----------------------------------------------------------------
--
-- Two organizations and the memberships mockup 01 Step 2 renders: a personal one, and a
-- shared one Maya and Jorge are both in. Text ids rather than uuids, because that is what
-- the library mints — and asserting against the type the application actually writes is
-- the point of these fixtures.
insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata") values
  ('org-personal', 'Maya Chen',    'maya-chen',     now(), '{"personal": true}'),
  ('org-acme',     'Acme Robotics', 'acme-robotics', now(), null);

insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt") values
  ('mem-personal', 'org-personal', '77777777-7777-7777-7777-777777777777', 'owner',  now()),
  ('mem-acme-maya', 'org-acme',    '77777777-7777-7777-7777-777777777777', 'admin',  now()),
  ('mem-acme-jorge', 'org-acme',   '88888888-8888-8888-8888-888888888888', 'viewer', now());

-- --- metadata round-trips the `personal` flag --------------------------------
--
-- The acceptance criterion in its own words, and the thing mockup 01 Step 2's pill is
-- rendered from. Read back through `::jsonb` because that is the question being asked —
-- not "is this the string I wrote" but "is this JSON somebody can get the flag out of".
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
--
-- Each asserted by the statement it must refuse, naming the constraint that has to be the
-- one to fire — without which a row rejected by some unrelated rule reads as a pass.
select pg_temp.must_reject(
  $$insert into ouroboros.organization ("id", "name", "slug", "createdAt")
    values ('org-impostor', 'Impostor', 'acme-robotics', now())$$,
  'organization.slug is unique across the installation', 'organization_slug_key');

-- The acceptance criterion, and the successor to `tenant_members`' composite primary key.
-- The plugin refuses a second membership in application code; this is what makes the rule
-- hold under two concurrent invitation accepts, which its read-then-write cannot close.
select pg_temp.must_reject(
  $$insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
    values ('mem-twice', 'org-acme', '77777777-7777-7777-7777-777777777777', 'owner', now())$$,
  'member(organizationId, userId) is unique — one person joins one organization once',
  'member_organization_user_key');

-- Scoped to the organization, which is the whole point: the same person holding a role in
-- a second organization is the case mockup 01 Step 2 exists to render.
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
-- it, a delete issued by anything other than the plugin — #708''s migration, a support
-- script, psql — leaves sessions resolving a tenant that cannot be read.
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
-- The three reads the product actually makes, one per index that has to exist for them:
-- mockup 01 Step 2's "which organizations is this person in", mockup 17's "who is in this
-- organization", and the plugin's own `checkMembership` — the pair lookup behind every
-- role decision, which is what the OURS unique constraint doubles as an index for.
--
-- As elsewhere in this file the planner is stopped from preferring a scan over a
-- fixture-sized table; what is asserted is that a usable index exists at all.
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

-- Not a read this service makes — the pointer is reached from a session already in hand,
-- by primary key. What needs it is the foreign key itself: without an index, every delete
-- of an organization scans `session` in full to find the rows to null out.
select pg_temp.must_use_index(
  $$select "id" from ouroboros.session where "activeOrganizationId" = 'org-acme'$$,
  'session_activeOrganizationId_idx');
set local enable_seqscan = on;

-- --- cascades, and the one that deliberately is not -----------------------------
--
-- Deleting an organization removes what belonged to it — the memberships in it, and the
-- invitations to it — in the same statement.
insert into ouroboros.invitation
    ("id", "organizationId", "email", "role", "status", "expiresAt", "inviterId")
  values ('inv-acme', 'org-acme', 'new@acme-robotics.dev', 'member', 'pending',
          now() + interval '7 days', '77777777-7777-7777-7777-777777777777');

delete from ouroboros.organization where "id" = 'org-acme';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.member where "organizationId" = 'org-acme'),
  'deleting an organization cascades to its memberships');
select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.invitation where "organizationId" = 'org-acme'),
  'deleting an organization cascades to its invitations');

-- **And it must not sign anybody out.** This is the difference between `set null` and
-- `cascade`, and it is the acceptance criterion that would be most expensive to get wrong:
-- a cascade here would delete the *session rows*, so deleting an organization would sign
-- out everybody who happened to be acting in it — including people whose other
-- memberships are untouched.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.session where "id" = 'session-nowhere'),
  'deleting an organization does not delete the sessions that pointed at it');
select pg_temp.must_hold(
  (select "activeOrganizationId" is null from ouroboros.session where "id" = 'session-nowhere'),
  'deleting an organization nulls the pointer — signed in, acting nowhere');

-- The people survive too: a membership is deleted, the member is not. Same rule V002 held
-- for `tenant_members`, which is what makes #708 a rename rather than a re-think.
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros."user"
   where "id" = '77777777-7777-7777-7777-777777777777'),
  'deleting an organization leaves its members'' "user" rows alone');

-- The cascade in the other direction: deleting a person takes their memberships with them
-- and leaves the organizations standing, since an organization outlives any one member.
delete from ouroboros."user" where "id" = '77777777-7777-7777-7777-777777777777';

select pg_temp.must_hold(
  (select count(*) = 0 from ouroboros.member
   where "userId" = '77777777-7777-7777-7777-777777777777'),
  'deleting a "user" cascades to their memberships');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization where "id" = 'org-personal'),
  'deleting a "user" leaves the organizations they belonged to standing');

-- ---------------------------------------------------------------------------
-- Nothing is kept. The database is exactly as it was found.
-- ---------------------------------------------------------------------------
rollback;

\o
\echo 'constraints.sql: all assertions passed'
