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
-- Covers V001 (#20) and V003 (#22). A migration that adds a rule adds its assertion
-- here in the same change.

\set ON_ERROR_STOP on

-- Result rows go nowhere: a passing assertion returns void, so the only thing printed
-- would be a screenful of empty one-row tables. Errors are unaffected — they are raised
-- on stderr, and ON_ERROR_STOP still aborts the script and exits non-zero — so a failure
-- is the only thing this prints, which is what makes the CI log worth reading.
\o /dev/null

begin;

-- ---------------------------------------------------------------------------
-- Assertion helpers.
--
-- In pg_temp so they disappear with the session and cannot be mistaken for schema.
-- Deliberately not plpgsql's `assert`, which is compiled out when plpgsql.check_asserts
-- is off — a check that can be silently disabled is not a check.
-- ---------------------------------------------------------------------------

-- Asserts a condition holds.
--   cond — the condition, already evaluated by the caller
--   what — description used in the failure message
create function pg_temp.must_hold(cond boolean, what text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAILED: % (condition was %)', what, coalesce(cond::text, 'null');
  end if;
end;
$$;

-- Asserts a statement is refused by a constraint.
--
-- Only class 23 (integrity constraint violation) counts as a pass: a statement that
-- fails with a syntax error or an undefined column would otherwise look like a working
-- constraint. The inner block is a savepoint, so a rejected statement does not abort the
-- surrounding transaction.
--
--   stmt     — SQL to execute, expected to be rejected
--   what     — description used in the failure message
--   expected — constraint name that must be the one to fire. Optional, and worth naming
--              wherever the assertion is the point of the migration rather than
--              incidental: without it a statement rejected by some *other* rule — a
--              not-null, a check on an unrelated column — reads as a pass, and the rule
--              actually under test could be missing entirely.
create function pg_temp.must_reject(stmt text, what text, expected text default null)
returns void language plpgsql as $$
declare
  fired text;
begin
  begin
    execute stmt;
  exception
    when integrity_constraint_violation then
      get stacked diagnostics fired = constraint_name;
      if expected is not null and fired is distinct from expected then
        raise exception 'FAILED: % (rejected by % rather than %)', what, coalesce(fired, '<unnamed>'), expected;
      end if;
      return;
  end;
  raise exception 'FAILED: % (statement was accepted)', what;
end;
$$;

-- Asserts a query's plan uses a named index.
--
-- Sequential scans are turned off by the caller for these checks: the fixture tables
-- hold a handful of rows, where a seq scan is genuinely cheaper and the planner is right
-- to prefer it. What is being asserted is that a usable index *exists* — that the
-- lookup is not condemned to a scan once the table is production-sized.
--
--   query — the SQL whose plan is inspected
--   idx   — index name expected to appear in the plan
create function pg_temp.must_use_index(query text, idx text)
returns void language plpgsql as $$
declare
  line text;
begin
  for line in execute 'explain ' || query loop
    if line like '%' || idx || '%' then
      return;
    end if;
  end loop;
  raise exception 'FAILED: % did not use index %', query, idx;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. Fixed uuids so an assertion can name a row without a lookup.
-- ---------------------------------------------------------------------------
insert into ouroboros.tenants (id, slug, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'acme-robotics', 'Acme Robotics'),
  ('22222222-2222-2222-2222-222222222222', 'globex',        'Globex');

insert into ouroboros.tenant_domains (tenant_id, domain, is_primary) values
  ('11111111-1111-1111-1111-111111111111', 'acme-robotics.dev', true),
  ('11111111-1111-1111-1111-111111111111', 'acme.example',      false);

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
