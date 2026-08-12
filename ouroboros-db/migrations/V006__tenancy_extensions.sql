-- V006__tenancy_extensions.sql — the tenancy cut-over: rows move to the BetterAuth
-- tables, the extension tables re-point, and the V001/V002 generation is dropped.
--
-- V004 (#706) and V005 (#707) created the successors and left both generations standing:
-- `"user"`/`account` beside `users`/`user_identities`, `organization`/`member` beside
-- `tenants`/`tenant_members`. This migration is the moment the old generation stops
-- existing. Five steps, strictly in this order:
--
--   0. run V004's back-fill one last time  (people seeded after V004 come across)
--   1. `tenants`        → `organization`   (ids preserved, spelled as text)
--   2. `tenant_members` → `member`         (roles verbatim: owner|admin|member|viewer)
--   3. `tenant_domains`, `github_orgs`     re-parented onto `organization_id`
--   4. drop `tenants`, `tenant_members`, `users`, `user_identities`  — the point of
--      no return
--
-- **This is the one migration in the chain that cannot be reverted by redeploying the
-- previous build.** Every migration before it only added; this one drops populated
-- tables, and the only way back afterwards is a restore. Snapshot the database before
-- applying it anywhere that matters (`pg_dump -Fc` is enough), and rehearse against a
-- seeded copy first — `ci/db` does exactly that on every run (tests/rehearsal/), so the
-- rehearsal is a standing check rather than a one-time ceremony.
--
-- What makes the move a rename rather than a remapping is a property V004 and V005
-- bought deliberately: the BetterAuth ids are `text`, ours are uuids, and a uuid renders
-- to text without loss. `tenants.id::text` becomes `organization."id"`, and
-- `tenant_members.user_id::text` already names an existing `"user"` row because V004's
-- back-fill preserved ids the same way. No mapping table is needed, so none is built.
--
-- Everything this migration depends on is **asserted before anything is written** — the
-- pre-flight block below raises and rolls the whole migration back if the database is
-- not in the state the steps assume. A failed V006 therefore leaves the database
-- exactly as it found it; only a *successful* one drops anything.
--
-- `"user"` is quoted at every reference, as everywhere in this repository: unquoted it
-- is the SQL keyword, one letter from the `users` table this migration drops.
--
-- Filed as issue #708.

-- ---------------------------------------------------------------------------
-- Step 0 — V004's back-fill, run one last time before it is dropped.
--
-- On a database created from empty, Flyway applies the versioned migrations first and
-- the repeatable seed last — so V004's back-fill ran against empty tables and copied
-- nothing, and the demo people exist only in `users`/`user_identities`. V004's header
-- describes exactly this state and prescribes exactly this call; every development
-- database stood up since V004 merged is in it. The function is idempotent, so on a
-- database whose people already came across — at V004 time, or by the hand-run V004
-- documents — this copies nothing and costs nothing.
--
-- It runs *before* the pre-flight below on purpose: whoever this can bring across is
-- not a problem a human needs to hear about. Whoever it cannot — the id and email
-- conflicts the function deliberately skips — still is, and the pre-flight is what
-- names them.
-- ---------------------------------------------------------------------------
do $$
declare
  filled record;
begin
  select * into filled from ouroboros.backfill_betterauth_core();
  raise notice 'V006 back-filled % user row(s) and % account row(s) left behind by the seed',
    filled.users_copied, filled.accounts_copied;
end
$$;

-- ---------------------------------------------------------------------------
-- Pre-flight: assert the ground before moving onto it.
--
-- Three ways the database could disagree with this migration's assumptions, each
-- checked here so the failure is a named sentence at the top of the run rather than a
-- constraint violation halfway through — and each one something a human has to resolve,
-- which is why the answer is an exception and not a silent skip:
--
--   * An `organization` row already carrying a tenant's id or slug. #704 has been
--     creating organizations at first sign-in, and the plugin mints its own ids and
--     slugs; a collision means two live records claim to be the same workspace, and
--     which one wins is not this migration's decision to make.
--   * A `tenant_members.role` outside `owner|admin|member|viewer`. V002's check
--     constraint holds exactly that vocabulary and #704 reproduced it (`viewer` as the
--     custom access-control role), so the copy in step 2 carries roles verbatim — but
--     that mapping is asserted rather than assumed, because a constraint can be altered
--     and a migration that copied an unknown role would smuggle it past the application.
--   * A `tenant_members.user_id` with no `"user"` row — *after* step 0 just retried
--     the back-fill. What remains is a person it deliberately skipped, whose id or
--     email already existed in `"user"`, and V004 left that resolution to a human. A
--     membership pointing at a skipped person cannot come across — and dropping it
--     silently would revoke someone's access.
-- ---------------------------------------------------------------------------
do $$
declare
  id_collisions   bigint;
  slug_collisions bigint;
  bad_roles       bigint;
  missing_users   bigint;
begin
  select count(*) into id_collisions
    from ouroboros.tenants t
   where exists (select 1 from ouroboros.organization o where o."id" = t.id::text);
  if id_collisions > 0 then
    raise exception 'V006 pre-flight: % tenant id(s) already exist in organization — resolve the duplicate workspaces by hand before migrating', id_collisions;
  end if;

  select count(*) into slug_collisions
    from ouroboros.tenants t
   where exists (select 1 from ouroboros.organization o where o."slug" = t.slug);
  if slug_collisions > 0 then
    raise exception 'V006 pre-flight: % tenant slug(s) already exist in organization — resolve the duplicate workspaces by hand before migrating', slug_collisions;
  end if;

  select count(*) into bad_roles
    from ouroboros.tenant_members
   where role not in ('owner', 'admin', 'member', 'viewer');
  if bad_roles > 0 then
    raise exception 'V006 pre-flight: % membership(s) carry a role outside owner|admin|member|viewer — the V002 → organization-plugin role mapping does not cover them', bad_roles;
  end if;

  select count(*) into missing_users
    from ouroboros.tenant_members m
   where not exists (select 1 from ouroboros."user" u where u."id" = m.user_id::text);
  if missing_users > 0 then
    raise exception 'V006 pre-flight: % membership(s) name a person with no "user" row — V004''s back-fill skipped them (id or email conflict); resolve those people before migrating', missing_users;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Steps 1 and 2 — the rows move.
--
-- One block rather than two bare inserts so the counts can be captured and said out
-- loud: the `raise notice` at the foot is the record a CI log or a rehearsal keeps of
-- how many workspaces and memberships this migration moved. The pre-flight above
-- guarantees no conflict, so there is deliberately no `on conflict` here — a violation
-- at this point would mean the database changed under the migration, and failing is the
-- correct response to that.
-- ---------------------------------------------------------------------------
do $$
declare
  moved_organizations bigint;
  moved_members       bigint;
begin
  -- `tenants` → `organization`, id for id.
  --
  -- `metadata` deserves its sentence. The plugin reads it as JSON text and #704 writes
  -- `{"personal": true}` on the organization it creates at first sign-in — but V001
  -- never modeled a personal tenant, so there is nothing to map that flag *from* and no
  -- row gets one; inventing it here would mark a real workspace as somebody's personal
  -- space. What V001 did model is `status` (active | suspended | deleted, the latter a
  -- soft-delete marker), and `organization` has no column for it — so a non-active
  -- status is carried into `metadata` rather than silently flattened to "active" by the
  -- drop in step 4. The application does not read that key today; it exists so the fact
  -- survives for whatever suspension model comes later.
  insert into ouroboros.organization ("id", "name", "slug", "createdAt", "metadata")
  select
    t.id::text,
    t.display_name,
    t.slug,
    t.created_at,
    case when t.status <> 'active'
         then json_build_object('status', t.status)::text
    end
  from ouroboros.tenants t;
  get diagnostics moved_organizations = row_count;

  -- `tenant_members` → `member`, roles verbatim.
  --
  -- The surrogate `id` is minted here because the old primary key *was* the
  -- (tenant_id, user_id) pair — there is no old id to preserve, and nothing anywhere
  -- stores a membership id, so a generated uuid-as-text loses nothing.
  --
  -- `createdAt` is `invited_at` — V002's row-creation time. Two facts have no column to
  -- move into and are consciously left behind: `joined_at` (a membership that was still
  -- an outstanding invitation arrives as a full member, because V005's `invitation`
  -- cannot represent it without fabricating an inviter and an expiry nobody set) and
  -- `updated_at` (the plugin's table does not carry one — see V005 on why no column and
  -- no trigger were added).
  insert into ouroboros.member ("id", "organizationId", "userId", "role", "createdAt")
  select
    gen_random_uuid()::text,
    m.tenant_id::text,
    m.user_id::text,
    m.role,
    m.invited_at
  from ouroboros.tenant_members m;
  get diagnostics moved_members = row_count;

  raise notice 'V006 moved % tenant(s) into organization and % membership(s) into member',
    moved_organizations, moved_members;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 3 — the survivors re-point.
--
-- `tenant_domains` and `github_orgs` keep their rows, their rules and their snake_case
-- (decision A4: the library's shape governs the library's tables and stops there; these
-- are ours). Each gains `organization_id`, back-filled through the same id-as-text
-- rendering the inserts above used, and loses `tenant_id` once the new column is
-- null-free — PostgreSQL drops the old column's foreign key and indexes with it.
--
-- `github_repos` does not appear here, deliberately: it hangs off `github_orgs.org_id`,
-- which does not change. The tenant was always reachable through the org rather than
-- stored twice, and that choice (V003's) is what keeps this step to two tables.
-- ---------------------------------------------------------------------------

-- --- tenant_domains ---------------------------------------------------------
alter table ouroboros.tenant_domains
  add column organization_id text;

update ouroboros.tenant_domains
   set organization_id = tenant_id::text;

-- Not null only after the back-fill, and the cascade restates V001's rule under the new
-- parent: a deleted organization takes its domains with it, so no domain outlives its
-- workspace and keeps the name reserved against `tenant_domains_domain_key` — which
-- survives this migration untouched and remains the sign-in lookup index (#712's path).
alter table ouroboros.tenant_domains
  alter column organization_id set not null,
  add constraint tenant_domains_organization_id_fkey
    foreign key (organization_id) references ouroboros.organization ("id") on delete cascade;

comment on column ouroboros.tenant_domains.organization_id is
  'Owning organization (was tenant_id until V006). Snake_case per decision A4 — our table, our style.';

-- V001's one-primary-per-tenant partial unique index, re-scoped. Same shape and same
-- argument: the rule applies only to the `true` rows, so a plain unique constraint on
-- the pair would wrongly limit the non-primary domains too.
create unique index tenant_domains_one_primary_per_organization
  on ouroboros.tenant_domains (organization_id)
  where is_primary;

-- Listing an organization's domains, as V001's tenant_id index served listing a
-- tenant's. The unique index above cannot: it only holds the primary rows.
create index tenant_domains_organization_id_idx
  on ouroboros.tenant_domains (organization_id);

-- Last, so the table is never without a parent column: dropping tenant_id drops
-- `tenant_domains_tenant_id_fkey`, `tenant_domains_one_primary_per_tenant` and
-- `tenant_domains_tenant_id_idx` with it.
alter table ouroboros.tenant_domains
  drop column tenant_id;

-- --- github_orgs -------------------------------------------------------------
alter table ouroboros.github_orgs
  add column organization_id text;

update ouroboros.github_orgs
   set organization_id = tenant_id::text;

-- The unique key moves with the parent: (organization_id, login) is V003's
-- (tenant_id, login) restated — enablement is per workspace, not global, and two
-- organizations may each enable the same GitHub org. Its leading column also serves
-- "list this organization's orgs", exactly as V003 argued, so no separate index.
alter table ouroboros.github_orgs
  alter column organization_id set not null,
  add constraint github_orgs_organization_id_fkey
    foreign key (organization_id) references ouroboros.organization ("id") on delete cascade,
  add constraint github_orgs_org_login_key unique (organization_id, login);

comment on column ouroboros.github_orgs.organization_id is
  'Owning organization (was tenant_id until V006). First hop of organization → github_orgs → github_repos.';

-- Drops `github_orgs_tenant_id_fkey` and `github_orgs_tenant_login_key` with the column.
alter table ouroboros.github_orgs
  drop column tenant_id;

-- ---------------------------------------------------------------------------
-- Step 4 — the point of no return.
--
-- Dependency order, not size order: `tenant_members` references `tenants` and `users`,
-- `user_identities` references `users`, and nothing references `tenants` any more
-- because step 3 just moved the last two foreign keys off it. Plain `drop table`, no
-- `cascade` — if something still points at one of these, failing is the right answer.
--
-- `users` and `user_identities` are V004's leftovers rather than this file's: that
-- migration copied them into `"user"`/`account` and deliberately left the originals as
-- the revert path while #702 was proven. It has been; the path closes here.
--
-- The back-fill function goes with the tables it reads — V004 said this drop was #708's
-- to make. tests/constraints.sql asserts all four tables and the function stay gone, so
-- `ci/db` fails if any of them ever reappears.
-- ---------------------------------------------------------------------------
drop table ouroboros.tenant_members;
drop table ouroboros.user_identities;
drop table ouroboros.users;
drop table ouroboros.tenants;

drop function ouroboros.backfill_betterauth_core();
