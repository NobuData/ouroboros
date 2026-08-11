-- V001__tenants.sql — tenants, and the domains that resolve them at sign-in.
--
-- The root of the schema. Everything else in the tenancy database is reachable from a
-- row in `tenants` by following foreign keys, and every one of those keys cascades, so
-- deleting a tenant removes the tenant's data rather than orphaning it.
--
-- Two tables because they answer two different questions. `tenants` is *who the tenant
-- is* — a stable id other modules store, a slug humans and URLs use, a lifecycle status.
-- `tenant_domains` is *how a sign-in finds them*: mockup 01 resolves the tenant from the
-- email domain, one tenant may present several domains, and exactly one of them is the
-- primary the product displays back.
--
-- Filed as issue #20.

-- ---------------------------------------------------------------------------
-- Shared trigger function — `updated_at` maintenance.
--
-- Here rather than in a later migration because `tenants` is the first table to need it
-- and every subsequent table wants the same behaviour; V003 attaches this same function
-- to its own tables. Keeping one function means the semantics cannot drift between
-- tables, and a fix lands everywhere at once.
--
-- `updated_at` is set from the server clock rather than trusted from the client: a
-- caller that forgets the column, or supplies a stale value, must not be able to make a
-- row look older than it is. Assigning unconditionally in a BEFORE trigger overwrites
-- whatever the statement supplied, which is the point.
--
-- `create or replace` rather than a guarded `create`: this is a repeatable definition,
-- and replacing it is a no-op on a database that already has the identical body.
-- ---------------------------------------------------------------------------
create or replace function ouroboros.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function ouroboros.touch_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at from the server clock, ignoring any value the statement supplied.';

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table ouroboros.tenants (
  -- Surrogate uuid rather than the slug: the slug is a display and URL concern and a
  -- tenant may want to change it, while every foreign key in the schema points here and
  -- must never have to be rewritten. `gen_random_uuid()` is core in PostgreSQL 13+, so
  -- this costs no extension.
  id            uuid        primary key default gen_random_uuid(),

  -- The URL- and CLI-safe handle. Constrained rather than free text because it appears
  -- in paths and command arguments: lower-case alphanumerics separated by single
  -- hyphens, no leading or trailing hyphen, 2–63 characters — the shape a DNS label
  -- already has, which keeps a slug usable if one is ever wanted as a subdomain.
  slug          text        not null,

  -- What a human reads. Free text on purpose; it carries no machine meaning.
  display_name  text        not null,

  -- Lifecycle. A check constraint rather than an enum type: the accepted values are
  -- read by application code as plain strings, and adding a value later is one migration
  -- against this constraint instead of an `alter type` that cannot run in a transaction
  -- with other statements. `deleted` is a soft-delete marker — the row and its children
  -- survive so an accidental deletion is recoverable; a hard `delete` still cascades.
  status        text        not null default 'active',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint tenants_slug_key      unique (slug),
  constraint tenants_slug_format   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 63),
  constraint tenants_display_name_present check (length(btrim(display_name)) > 0),
  constraint tenants_status_valid  check (status in ('active', 'suspended', 'deleted'))
);

comment on table ouroboros.tenants is
  'An isolated customer workspace. The root of the tenancy schema; every other table cascades from here.';
comment on column ouroboros.tenants.slug is
  'URL- and CLI-safe handle, unique across the installation. DNS-label shaped.';
comment on column ouroboros.tenants.status is
  'active | suspended | deleted. `deleted` is a soft-delete marker, not a hard removal.';

create trigger tenants_touch_updated_at
  before update on ouroboros.tenants
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_domains
--
-- The sign-in path takes an email address, splits the domain off, and looks the tenant
-- up by it. That lookup happens on every sign-in, so it must be an index scan, and it
-- must be case-insensitive because nothing normalises the case of an address a human
-- types.
--
-- Case-insensitivity is bought by *storing* the domain folded rather than by `citext` or
-- a `lower(domain)` functional index. `citext` is an extension, and `create extension`
-- needs rights a managed PostgreSQL does not always grant the migration role; a
-- functional index works but leaves the stored value un-normalised, so two rows can
-- disagree about the case of what is meant to be the same domain and every caller has to
-- remember to fold. Folding on the way in makes the plain unique btree below both the
-- uniqueness rule and the lookup index, and `where domain = lower($1)` is an index scan.
-- ---------------------------------------------------------------------------
create table ouroboros.tenant_domains (
  id          uuid        primary key default gen_random_uuid(),

  -- Cascade: a deleted tenant takes its domains with it. Without this the domain would
  -- outlive the tenant and keep the name reserved against the unique index below.
  tenant_id   uuid        not null references ouroboros.tenants (id) on delete cascade,

  -- Stored lower-cased — the check constraint is what makes that a guarantee rather than
  -- a convention every writer has to honour.
  domain      text        not null,

  -- The one domain shown back to the user. Not a column on `tenants` because it must be
  -- one of these rows; the partial unique index below is what limits it to one per
  -- tenant, and it permits zero, so a tenant mid-setup is representable.
  is_primary  boolean     not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Unique across the whole table, not per tenant: a domain identifies exactly one
  -- tenant at sign-in, so two tenants claiming the same one is the ambiguity this
  -- prevents.
  constraint tenant_domains_domain_key unique (domain),

  -- Shape check, deliberately loose: at least two dot-separated labels of the characters
  -- a hostname may contain. This rejects an email address or a stray space pasted into
  -- the field without trying to be a public-suffix list.
  --
  -- It is also what enforces the folding the header describes, and is load-bearing for
  -- it: the character class admits no upper case, so a value that survives this check is
  -- already lower-cased and the unique index above is case-insensitive in effect. A
  -- separate `check (domain = lower(domain))` would be unreachable — no value can fail
  -- it and pass this — so there is deliberately only one constraint here. **Relaxing
  -- this pattern to admit upper case would silently un-fold the column**, and would have
  -- to add that check back at the same time.
  constraint tenant_domains_domain_format
    check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
           and length(domain) <= 253)
);

comment on table ouroboros.tenant_domains is
  'Email domains that resolve to a tenant at sign-in. Stored lower-cased; globally unique.';
comment on column ouroboros.tenant_domains.domain is
  'Lower-cased domain. Look up with `where domain = lower($1)` to use tenant_domains_domain_key.';
comment on column ouroboros.tenant_domains.is_primary is
  'The domain displayed back to the user. At most one per tenant; zero is legal mid-setup.';

-- At most one primary per tenant. A partial index rather than a unique constraint
-- because the rule applies only to the `true` rows — the non-primary domains are
-- unconstrained, and a plain `unique (tenant_id, is_primary)` would wrongly allow only
-- one of those too.
create unique index tenant_domains_one_primary_per_tenant
  on ouroboros.tenant_domains (tenant_id)
  where is_primary;

-- Listing a tenant's domains is the other access path, and the unique index above is
-- keyed on `domain`, so it cannot serve it.
create index tenant_domains_tenant_id_idx
  on ouroboros.tenant_domains (tenant_id);

create trigger tenant_domains_touch_updated_at
  before update on ouroboros.tenant_domains
  for each row execute function ouroboros.touch_updated_at();
