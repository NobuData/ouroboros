-- rehearsal/post.sql — what the pre-V006 rows must look like after the cut-over.
--
-- The second half of the rehearsal pre.sql describes. Run it against the rehearsal
-- database after the ordinary `migrate` has applied V006: every assertion here is a
-- row-count or a spot value, because "the migration exited 0" is precisely the claim
-- the acceptance criteria refuse to accept.
--
-- The theme throughout is *the same logical tenant*: the domain, the GitHub org and the
-- repo that belonged to `acme-robotics` before the migration must each resolve — by
-- foreign key, not by coincidence of name — to the organization that carries the old
-- tenant's id and slug afterwards.
--
-- Read-only, like tests/seed.sql: it opens no transaction and writes nothing.

\set ON_ERROR_STOP on

-- Passing assertions return void; a failure is the only thing this prints.
\o /dev/null

-- must_hold, shared with the other suites.
\ir ../lib/assert.sql

-- ---------------------------------------------------------------------------
-- The point of no return was actually passed.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select to_regclass('ouroboros.tenants')         is null
      and to_regclass('ouroboros.tenant_members')  is null
      and to_regclass('ouroboros.users')           is null
      and to_regclass('ouroboros.user_identities') is null),
  'V006 dropped tenants, tenant_members, users and user_identities');

-- ---------------------------------------------------------------------------
-- tenants → organization: one row each, ids and slugs preserved.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.organization),
  'both tenants arrived in organization — and nothing else did');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.organization
   where "id" = '5eed0001-0000-4000-8000-000000000001'
     and "slug" = 'acme-robotics'
     and "name" = 'Acme Robotics'
     and "metadata" is null),
  'the active tenant became an organization with its id, slug and name intact, and no metadata');

-- The state the demo seed never contained: a suspended tenant's status survives the
-- drop, in metadata, as JSON something can read the fact back out of.
select pg_temp.must_hold(
  (select ("metadata"::jsonb ->> 'status') = 'suspended' from ouroboros.organization
   where "id" = 'ffff0001-0000-4000-8000-000000000001' and "slug" = 'globex'),
  'the suspended tenant''s status survived the migration in organization.metadata');

-- ---------------------------------------------------------------------------
-- tenant_members → member: every membership, roles verbatim.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 4 from ouroboros.member),
  'all four memberships arrived in member');

-- Spot values, matched person by person through "user" — which still holds the ids
-- V004's back-fill preserved, so the join is by the same uuids the old tables used.
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.member m
     join ouroboros."user" u on u."id" = m."userId"
    where m."organizationId" = '5eed0001-0000-4000-8000-000000000001'
      and (u."email", m."role") in (
        ('ken@acme-robotics.dev',   'owner'),
        ('maya@acme-robotics.dev',  'admin'),
        ('jorge@acme-robotics.dev', 'member'))),
  'the demo people hold the same roles in the same workspace as before the migration');

-- `viewer` — #704's custom access-control role — came across verbatim, and the
-- membership whose invitation was never accepted is a member row now (V006's documented
-- trade: the plugin's invitation table cannot represent it without fabricating an
-- inviter).
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.member m
   where m."organizationId" = 'ffff0001-0000-4000-8000-000000000001'
     and m."userId" = 'ffff0003-0000-4000-8000-000000000001'
     and m."role" = 'viewer'),
  'the viewer role and the un-accepted membership both arrived, role verbatim');

-- ---------------------------------------------------------------------------
-- The people and their accounts were untouched — V006 moved nothing V004 owned.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 4 from ouroboros."user"
   where "id" in ('5eed0003-0000-4000-8000-000000000001',
                  '5eed0003-0000-4000-8000-000000000002',
                  '5eed0003-0000-4000-8000-000000000003',
                  'ffff0003-0000-4000-8000-000000000001')),
  'every person is still in "user" under their preserved id');
select pg_temp.must_hold(
  (select count(*) = 3 from ouroboros.account
   where "providerId" = 'github'
     and "accountId" in ('900000001', '900000002', '900000003')),
  'every GitHub account is still in account');

-- ---------------------------------------------------------------------------
-- The survivors re-pointed: same rows, same logical tenant, new parent column.
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select count(*) = 2 from ouroboros.tenant_domains),
  'both domains survived the re-parenting');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_domains
   where id = '5eed0002-0000-4000-8000-000000000001'
     and domain = 'acme-robotics.dev'
     and is_primary
     and organization_id = '5eed0001-0000-4000-8000-000000000001'),
  'acme-robotics.dev still resolves the same logical tenant, and is still its primary');
select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.tenant_domains
   where domain = 'globex.example'
     and organization_id = 'ffff0001-0000-4000-8000-000000000001'),
  'globex.example still resolves the suspended tenant');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_orgs
   where id = '5eed0005-0000-4000-8000-000000000001'
     and organization_id = '5eed0001-0000-4000-8000-000000000001'
     and login = 'acme-robotics'
     and enabled),
  'the GitHub org still belongs to the same logical tenant, still enabled');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.github_repos
   where id = '5eed0006-0000-4000-8000-000000000001'
     and org_id = '5eed0005-0000-4000-8000-000000000001'
     and name = 'helios-firmware'
     and enabled
     and default_branch = 'main'),
  'the repo still hangs off that org, untouched — V006 had no business with it');

-- The end-to-end read the product makes: from the domain a person signs in with, through
-- the organization, to the one repository in scope. If this row exists, the whole chain
-- re-pointed coherently.
select pg_temp.must_hold(
  (select count(*) = 1
     from ouroboros.tenant_domains d
     join ouroboros.organization o on o."id" = d.organization_id
     join ouroboros.github_orgs g  on g.organization_id = o."id"
     join ouroboros.github_repos r on r.org_id = g.id
    where d.domain = 'acme-robotics.dev'
      and o."slug" = 'acme-robotics'
      and g.enabled and r.enabled),
  'domain → organization → org → repo still resolves end to end for the demo workspace');

\o
\echo 'rehearsal/post.sql: all assertions passed — the cut-over preserved every row it moved'
