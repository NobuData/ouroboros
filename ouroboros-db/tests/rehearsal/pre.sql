-- rehearsal/pre.sql — a pre-V006 database, populated the way a real one was.
--
-- V006 (#708) is the one migration in the chain that drops populated tables, so "it
-- applies cleanly to an empty database" proves almost nothing about it. What has to be
-- proved is what it does to *rows*: that every domain, org and repo still resolves to
-- the same logical tenant afterwards, that roles come across verbatim, and that the
-- soft-delete status V001 modelled survives the drop. `ci/db` therefore rehearses the
-- cut-over on every run: a scratch database is migrated to V005 **only** (versioned
-- migrations, no seed — see the workflow step), this file puts the pre-migration rows
-- in, the ordinary `migrate` then applies V006, and rehearsal/post.sql asserts what the
-- data looks like on the other side.
--
-- Run against anything past V005 this fails immediately — `tenants` does not exist —
-- which is the correct answer: a rehearsal against the wrong starting state would prove
-- nothing and pass anyway.
--
-- Two groups of rows:
--
--   * **The demo workspace, exactly as the pre-#708 R__dev_seed.sql wrote it** — same
--     `5eed…` ids, same slug, people, roles, org and repo. This is the acceptance
--     criterion's own fixture: "applied against a database seeded with the
--     pre-migration R__dev_seed".
--   * **The states the seed never contained**, because V006's interesting paths are
--     exactly the ones the happy demo data does not exercise: a `suspended` tenant
--     (its status must land in `organization.metadata` rather than be flattened), a
--     `viewer` membership (the role #704 recreates as a custom access-control role —
--     carried verbatim, asserted not assumed), and a membership whose invitation was
--     never accepted (`joined_at` null — arrives as a full member, V006's documented
--     trade). `ffff…` ids, so post.sql can tell the two groups apart on sight.
--
-- The foot of the file calls `ouroboros.backfill_betterauth_core()`, and that is not a
-- convenience: a real database at V005 has `"user"` and `account` populated, because
-- V004's back-fill ran when it was migrated (or was run by hand, which is the path this
-- exercises — the function exists for exactly this). V006's pre-flight refuses a
-- membership whose person has no `"user"` row, so a rehearsal that skipped the
-- back-fill would be rehearsing a database that cannot exist.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- The demo workspace, as the pre-migration seed left it.
-- ---------------------------------------------------------------------------
insert into ouroboros.tenants (id, slug, display_name, status) values
  ('5eed0001-0000-4000-8000-000000000001', 'acme-robotics', 'Acme Robotics', 'active');

insert into ouroboros.tenant_domains (id, tenant_id, domain, is_primary) values
  ('5eed0002-0000-4000-8000-000000000001',
   '5eed0001-0000-4000-8000-000000000001', 'acme-robotics.dev', true);

insert into ouroboros.users (id, email, display_name) values
  ('5eed0003-0000-4000-8000-000000000001', 'ken@acme-robotics.dev',   'Ken Suenobu'),
  ('5eed0003-0000-4000-8000-000000000002', 'maya@acme-robotics.dev',  'Maya Chen'),
  ('5eed0003-0000-4000-8000-000000000003', 'jorge@acme-robotics.dev', 'Jorge Reyes');

insert into ouroboros.user_identities (id, user_id, provider, external_id) values
  ('5eed0004-0000-4000-8000-000000000001',
   '5eed0003-0000-4000-8000-000000000001', 'github', '900000001'),
  ('5eed0004-0000-4000-8000-000000000002',
   '5eed0003-0000-4000-8000-000000000002', 'github', '900000002'),
  ('5eed0004-0000-4000-8000-000000000003',
   '5eed0003-0000-4000-8000-000000000003', 'github', '900000003');

insert into ouroboros.tenant_members (tenant_id, user_id, role, invited_at, joined_at) values
  ('5eed0001-0000-4000-8000-000000000001',
   '5eed0003-0000-4000-8000-000000000001', 'owner',  now(), now()),
  ('5eed0001-0000-4000-8000-000000000001',
   '5eed0003-0000-4000-8000-000000000002', 'admin',  now(), now()),
  ('5eed0001-0000-4000-8000-000000000001',
   '5eed0003-0000-4000-8000-000000000003', 'member', now(), now());

insert into ouroboros.github_orgs (id, tenant_id, login, enabled) values
  ('5eed0005-0000-4000-8000-000000000001',
   '5eed0001-0000-4000-8000-000000000001', 'acme-robotics', true);

insert into ouroboros.github_repos (id, org_id, name, enabled, default_branch) values
  ('5eed0006-0000-4000-8000-000000000001',
   '5eed0005-0000-4000-8000-000000000001', 'helios-firmware', true, 'main');

-- ---------------------------------------------------------------------------
-- The states the seed never contained.
-- ---------------------------------------------------------------------------
insert into ouroboros.tenants (id, slug, display_name, status) values
  ('ffff0001-0000-4000-8000-000000000001', 'globex', 'Globex', 'suspended');

insert into ouroboros.tenant_domains (id, tenant_id, domain, is_primary) values
  ('ffff0002-0000-4000-8000-000000000001',
   'ffff0001-0000-4000-8000-000000000001', 'globex.example', true);

-- Dana holds no GitHub identity — the back-fill below must mark them unverified — and
-- their invitation is still outstanding.
insert into ouroboros.users (id, email, display_name) values
  ('ffff0003-0000-4000-8000-000000000001', 'dana@globex.example', 'Dana Okafor');

insert into ouroboros.tenant_members (tenant_id, user_id, role, invited_at, joined_at) values
  ('ffff0001-0000-4000-8000-000000000001',
   'ffff0003-0000-4000-8000-000000000001', 'viewer', now(), null);

-- ---------------------------------------------------------------------------
-- What a real V005 database already had: the V004 back-fill's output.
-- ---------------------------------------------------------------------------
select * from ouroboros.backfill_betterauth_core();
