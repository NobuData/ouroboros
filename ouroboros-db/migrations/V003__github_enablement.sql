-- V003__github_enablement.sql — which GitHub orgs and repos a tenant has turned on.
--
-- This is the boundary of where Ouroboros may operate. Mockup 01 step 2 enables specific
-- orgs per tenant and specific repos within them; nothing outside an enabled repo is in
-- scope for any later module, so these two tables are what a permission check reads.
--
-- Enablement is data-only at this stage. The GitHub App installation flow that would
-- write `installed_at` is future product work — the shape holds it, and until then a
-- row is whatever put it there (an operator, the dev seed) with `installed_at` null.
--
-- Two flags, deliberately. An org row and a repo row each carry their own `enabled`, so
-- turning an org off suspends everything under it without discarding the per-repo
-- choices underneath — a caller must find *both* true, which is the check the acceptance
-- criterion for cascading scope depends on.
--
-- Both default to false. A row's existence records that Ouroboros knows about the org or
-- repo; `enabled` records that someone deliberately turned it on. Anything that appears
-- by a path nobody has thought about yet — an installation callback, a sync, a restore —
-- therefore arrives switched off rather than switched on. Failing closed is the right
-- posture for a table whose whole job is to bound what an autonomous agent may touch.
--
-- Filed as issue #22.

-- ---------------------------------------------------------------------------
-- github_orgs
--
-- Scoped per tenant, not global: two tenants may each enable an org they both belong to,
-- and each holds its own enablement and its own installation. The unique key is
-- therefore (tenant_id, login) rather than login alone.
-- ---------------------------------------------------------------------------
create table ouroboros.github_orgs (
  id            uuid        primary key default gen_random_uuid(),

  -- Cascade — the first hop of tenant → orgs → repos. Deleting a tenant must not leave
  -- enablement rows behind that still name a boundary for a tenant that is gone.
  tenant_id     uuid        not null references ouroboros.tenants (id) on delete cascade,

  -- The org's GitHub login — the `NobuData` in github.com/NobuData. Stored lower-cased
  -- for the same reason tenant_domains.domain is (V001): GitHub treats logins
  -- case-insensitively, so `NobuData` and `nobudata` are one org and must not become two
  -- rows. Folding on the way in makes the unique index below enforce that, and makes
  -- `where login = lower($1)` an index scan.
  login         text        not null,

  -- Off until deliberately turned on. See the header.
  enabled       boolean     not null default false,

  -- When the GitHub App was installed on this org. Null means "not installed" — which is
  -- every row today, since the installation flow is future work. Nullable rather than
  -- defaulted because `now()` would assert an installation that never happened.
  installed_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint github_orgs_tenant_login_key unique (tenant_id, login),

  -- GitHub's own rule for a login: alphanumerics and single hyphens, no leading or
  -- trailing hyphen, at most 39 characters. Checked here so a path that never reaches
  -- GitHub cannot store something GitHub could not have issued.
  --
  -- The character class admits no upper case, which is what enforces the folding
  -- described above and makes the unique key case-insensitive in effect; a separate
  -- `check (login = lower(login))` would be unreachable. Relaxing this pattern to admit
  -- upper case would un-fold the column and would have to add that check back.
  constraint github_orgs_login_format
    check (login ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(login) between 1 and 39)
);

comment on table ouroboros.github_orgs is
  'GitHub organisations a tenant has enabled. With github_repos, the boundary of where Ouroboros may operate.';
comment on column ouroboros.github_orgs.login is
  'Lower-cased GitHub org login, unique within the tenant. Look up with `where login = lower($1)`.';
comment on column ouroboros.github_orgs.enabled is
  'Deliberate opt-in. Defaults false so a row created by any future flow arrives switched off.';
comment on column ouroboros.github_orgs.installed_at is
  'When the GitHub App was installed on this org; null until the installation flow exists.';

-- Listing a tenant's orgs is the common read, and the unique index above is usable for
-- it — (tenant_id, login) is left-prefixed by tenant_id — so no second index is created
-- for that path.

create trigger github_orgs_touch_updated_at
  before update on ouroboros.github_orgs
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- github_repos
--
-- Hung off the org rather than off the tenant. The tenant is reachable through
-- `org_id`, and duplicating `tenant_id` here would be a second copy of the same fact —
-- one that could disagree with the org's, and would then say a repo belongs to a tenant
-- its own org does not.
-- ---------------------------------------------------------------------------
create table ouroboros.github_repos (
  id              uuid        primary key default gen_random_uuid(),

  -- The second hop of the cascade. Combined with github_orgs.tenant_id's own cascade,
  -- deleting a tenant removes its orgs and, through this, their repos.
  org_id          uuid        not null references ouroboros.github_orgs (id) on delete cascade,

  -- The repo's name within the org — the `ouroboros` in NobuData/ouroboros, not the
  -- `NobuData/ouroboros`. Lower-cased on the same grounds as the org login.
  name            text        not null,

  -- Off until deliberately turned on, independently of the org's flag. See the header.
  enabled         boolean     not null default false,

  -- The branch work is cut from and targeted at. Null until it is known — it is
  -- discovered from GitHub, and defaulting it to 'main' would state as fact something
  -- nobody has looked up, for a repo that may well use another name.
  default_branch  text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint github_repos_org_name_key unique (org_id, name),

  -- GitHub's rule for a repository name: alphanumerics, hyphen, underscore and dot, at
  -- most 100 characters. `.` and `..` are excluded because GitHub rejects them and they
  -- are path traversal in anything that joins this onto a filesystem path — the
  -- character class already excludes `/`, so those two names are the only way this
  -- column could become a traversal.
  --
  -- As with the org login, the class admits no upper case, which is what folds the
  -- column and makes the unique key case-insensitive in effect; a separate
  -- `check (name = lower(name))` would be unreachable.
  constraint github_repos_name_format
    check (name ~ '^[a-z0-9._-]+$' and length(name) between 1 and 100
           and name not in ('.', '..')),

  -- A branch name, if one is present at all. Stated as an allow-list and four
  -- exclusions rather than as one regex of the characters git refuses: git's ref rules
  -- are longer than are worth restating here, and a deny-list is the shape that quietly
  -- lets something through. What this has to guarantee is narrower than "valid ref" —
  -- that the value is safe to interpolate into a command line and to join onto a
  -- filesystem path — and an allow-list guarantees that by construction.
  --
  -- Permitted: letters, digits, dot, underscore, hyphen and slash. Excluded: a leading
  -- or trailing slash, an empty path segment, a leading dot, and `..` anywhere — the
  -- last being the one that matters, since a slash is permitted and `..` is therefore
  -- path traversal in anything that builds a checkout directory from this.
  constraint github_repos_default_branch_format
    check (default_branch is null
           or (default_branch ~ '^[A-Za-z0-9._/-]+$'
               and default_branch !~ '^/'
               and default_branch !~ '/$'
               and default_branch !~ '//'
               and default_branch !~ '^\.'
               and default_branch !~ '\.\.'
               and length(default_branch) <= 255))
);

comment on table ouroboros.github_repos is
  'Repositories within an enabled org. A repo is in scope only when its own enabled flag and its org''s are both true.';
comment on column ouroboros.github_repos.name is
  'Lower-cased repo name within the org, without the owner prefix. Unique per org.';
comment on column ouroboros.github_repos.enabled is
  'Deliberate opt-in, independent of the org flag, so suspending an org preserves the per-repo choices.';
comment on column ouroboros.github_repos.default_branch is
  'Branch work is cut from; null until discovered from GitHub.';

-- Listing an org's repos is served by github_repos_org_name_key's leading column, so
-- there is no separate index on org_id.

create trigger github_repos_touch_updated_at
  before update on ouroboros.github_repos
  for each row execute function ouroboros.touch_updated_at();
