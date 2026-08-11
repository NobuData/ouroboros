-- V002__users_membership.sql — the human, their external identity, and their role in a tenant.
--
-- Three tables because sign-in involves three different things and conflating any two of
-- them costs something later. `users` is *the human* — one row per person, global rather
-- than tenant-scoped, because mockup 01 lets one person hold accounts in several tenants
-- and duplicating them per tenant would make "the same person" a fact nothing in the
-- schema states. `user_identities` is *how that human proves who they are* — a GitHub
-- account today, and the table exists as a separate row rather than as columns on `users`
-- so a second provider is a row and not a migration. `tenant_members` is *what they may
-- do in one tenant* — the role mockup 17 lists beside each member, which is a property of
-- the pairing and belongs on neither of the other two.
--
-- **No OAuth token, access token, refresh token or client secret is stored here, and none
-- may be added.** The identity row records only which external account a human proved
-- control of. What is done with a live GitHub session — obtaining it, refreshing it,
-- encrypting it at rest, revoking it — is ouroboros-rest's concern, and putting a
-- credential in this table would spread that responsibility across two modules and make
-- every `select *` over the tenancy schema a secret-bearing query. tests/constraints.sql
-- asserts the absence rather than trusting it: it reads information_schema and fails if a
-- column whose name looks like a credential ever appears on one of these three tables.
--
-- Applied after V003 in databases that already exist. Flyway does not require version
-- numbers to be contiguous, and ouroboros-db/README.md reserved this one, but a database
-- already carrying V003 sees a pending migration below its current version — which
-- `validate` rejects and `migrate` therefore refuses, since it validates first. The fix
-- is a development reset (`scripts/clean-dev` then `scripts/migrate`, or
-- `docker compose down -v && docker compose up`); `outOfOrder` is deliberately left off
-- rather than loosened for one gap that will never occur again. A database created from
-- empty applies V000 → V003 in order and never meets this.
--
-- Filed as issue #21.

-- ---------------------------------------------------------------------------
-- users
--
-- The person. Not tenant-scoped: the acceptance criterion "a user may belong to multiple
-- tenants with different roles" is only expressible if one row is reachable from several
-- `tenant_members` rows, and a per-tenant copy of the human would make two memberships
-- two people.
--
-- Deliberately thin. What is here is what mockup 17's member table renders — a name, an
-- address, an avatar — and nothing that belongs to a session, a preference or a provider.
-- ---------------------------------------------------------------------------
create table ouroboros.users (
  -- Surrogate uuid on the same grounds as V001's: `email` is a display and contact
  -- concern and a person may change theirs, while every foreign key here points at this.
  id            uuid        primary key default gen_random_uuid(),

  -- The human-readable handle for a person, and the only column that can say two rows
  -- are the same human. Unique for exactly that reason: GitHub returns a verified
  -- address, and a second row carrying it would put one person twice into mockup 17's
  -- member list with two independent sets of roles.
  --
  -- Stored lower-cased, as V001 stores domains, so the unique index is also the
  -- case-insensitive rule and `where email = lower($1)` is an index scan. Addresses are
  -- case-sensitive in their local part by RFC and case-insensitive at every provider
  -- anyone signs in with; treating `Ken@example.com` and `ken@example.com` as two humans
  -- is the failure that would actually happen, so the folding is the right trade.
  --
  -- Note this is *not* how a sign-in identifies someone — `user_identities` is. The
  -- address is how a human is recognised and contacted, not how they authenticate.
  email         text        not null,

  -- What mockup 17 prints beside the avatar. Free text; it carries no machine meaning,
  -- and is only required to be non-blank so a member row cannot render as nothing.
  display_name  text        not null,

  -- The avatar GitHub hosts. Null until one is known — a person created before their
  -- first sign-in, or a provider that offers none — because a placeholder is the UI's
  -- decision and inventing a URL here would state something untrue.
  avatar_url    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint users_email_key unique (email),

  -- Shape, deliberately loose: something, an `@`, something, a dot, something, with no
  -- whitespace anywhere. Rejecting a pasted display name or a stray space is the whole
  -- job; a full RFC 5322 grammar in a check constraint would reject addresses that
  -- genuinely deliver.
  constraint users_email_format
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
           and length(email) <= 320),

  -- The folding above, as a guarantee rather than a convention. Stated separately here
  -- because — unlike V001's domain and V003's login patterns, whose character classes
  -- admit no upper case and so enforce it implicitly — the format check above cannot:
  -- an address may contain almost any character, so its negated classes accept upper
  -- case and this constraint is what actually holds the column folded.
  constraint users_email_lowercase check (email = lower(email)),

  constraint users_display_name_present check (length(btrim(display_name)) > 0),

  -- An allow-list, for the same reason V003's `default_branch` is one: this value is
  -- interpolated into markup as an image source, and the shapes that matter are the ones
  -- that are not images at all. `javascript:` and `data:` URLs are what an allow-list of
  -- `http`/`https` excludes by construction, and excluding whitespace keeps the value
  -- from carrying an attribute or a second URL along with it. Escaping at render time is
  -- still the UI's job; this makes a stored value that needs escaping impossible to
  -- create in the first place.
  constraint users_avatar_url_format
    check (avatar_url is null
           or (avatar_url ~ '^https?://[^[:space:]]+$' and length(avatar_url) <= 2048))
);

comment on table ouroboros.users is
  'A person. Global rather than tenant-scoped, so one human can hold roles in several tenants.';
comment on column ouroboros.users.email is
  'Lower-cased, unique across the installation. How a person is recognised and contacted — not how they authenticate; see user_identities.';
comment on column ouroboros.users.avatar_url is
  'http(s) URL to the person''s avatar, or null when none is known. Restricted to http(s) because it is rendered as an image source.';

create trigger users_touch_updated_at
  before update on ouroboros.users
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- user_identities
--
-- An external account a human has proved control of. A row rather than columns on
-- `users` so that adding a second provider — enterprise SSO is already on the roadmap —
-- adds rows and not a migration against the user table, and so a person who links a work
-- and a personal GitHub account is one human with two identities rather than two humans.
--
-- Read the header again before adding a column here: this table holds *which account*,
-- never *the credential*.
-- ---------------------------------------------------------------------------
create table ouroboros.user_identities (
  id           uuid        primary key default gen_random_uuid(),

  -- Cascade: deleting a person removes the identities that pointed at them. Without it
  -- an orphaned identity would keep its (provider, external_id) pair reserved against
  -- the unique key below, and the same GitHub account could never sign in again.
  user_id      uuid        not null references ouroboros.users (id) on delete cascade,

  -- Which external system issued the identity. Text with a check rather than an enum,
  -- on the same grounds as V001's `status`: adding `saml` or `oidc` later is one
  -- ordinary migration against this constraint instead of an `alter type`.
  provider     text        not null,

  -- The provider's own immutable id for the account — GitHub's numeric user id, not the
  -- login. The login is what a person can rename out from under us; the id cannot
  -- change, which is what makes it safe as half of the unique key.
  --
  -- Text rather than a number because the next provider will not issue numbers.
  external_id  text        not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Acceptance criterion: the same GitHub identity cannot attach to two users. Scoped by
  -- provider, because two providers may independently issue the id `12345` and those are
  -- not the same account.
  constraint user_identities_provider_external_id_key unique (provider, external_id),

  constraint user_identities_provider_valid check (provider in ('github')),

  -- Non-blank and single-token. The value reaches a provider's API in a URL path, so
  -- whitespace in it is either a mistake or an attempt to append something.
  constraint user_identities_external_id_format
    check (external_id ~ '^[^[:space:]]+$' and length(external_id) <= 255)
);

comment on table ouroboros.user_identities is
  'External accounts a person signs in with. Records which account only — never a token, secret or credential.';
comment on column ouroboros.user_identities.provider is
  'github today. Text with a CHECK rather than an enum so another provider is an additive migration.';
comment on column ouroboros.user_identities.external_id is
  'The provider''s immutable id for the account — GitHub''s numeric user id, not the renameable login.';

-- Listing one person's identities is the common read and the unique key above cannot
-- serve it: its leading column is `provider`, not `user_id`.
--
-- Deliberately not unique on (user_id, provider): a person may link two GitHub accounts,
-- and forbidding that would be a rule the ticket does not ask for. The pair that must be
-- unique is (provider, external_id), which is the one above.
create index user_identities_user_id_idx
  on ouroboros.user_identities (user_id);

create trigger user_identities_touch_updated_at
  before update on ouroboros.user_identities
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_members
--
-- The pairing, and the role that comes with it. Mockup 17's member table is one query
-- against this joined to `users`.
--
-- The primary key is the (tenant_id, user_id) pair rather than a surrogate uuid — the
-- one table in this schema where that is so. The pair *is* the identity of the row:
-- there is nothing to say about a membership that is not said by naming the tenant and
-- the person, a surrogate would need the same unique constraint beside it anyway, and
-- making the pair the key is what makes "the same user cannot join a tenant twice" true
-- by construction rather than by a rule that could be dropped. Its index also serves the
-- membership list, whose leading term is always the tenant.
--
-- There is no `created_at`. `invited_at` already records when the row came into being,
-- and a second column that is equal to it in every row is a fact stored twice and one
-- that can disagree with itself. `updated_at` is kept — a role change is a real update
-- and worth a timestamp.
--
-- One rule is deliberately *not* enforced here: that a tenant always retains at least one
-- `owner`. It cannot be written as a constraint — it spans rows and must survive both a
-- role change and a delete — so it is a trigger or an application invariant, and it
-- belongs with the tenancy API (#31) that will be the only thing allowed to write here.
-- ---------------------------------------------------------------------------
create table ouroboros.tenant_members (
  -- Both sides cascade. A deleted tenant takes its memberships with it, and so does a
  -- deleted person; a membership naming either one after it is gone would grant a role
  -- in a workspace that does not exist, or to nobody.
  tenant_id   uuid        not null references ouroboros.tenants (id) on delete cascade,
  user_id     uuid        not null references ouroboros.users (id)   on delete cascade,

  -- What this person may do in this tenant. Text with a check rather than an enum, per
  -- the ticket: adding a role later is one migration against this constraint, where an
  -- `alter type ... add value` cannot run in a transaction alongside the backfill that
  -- would accompany it.
  --
  -- No default, deliberately — and this is the one place V003's fail-closed default does
  -- not transfer. An `enabled` flag has a safe off position; a role does not, because the
  -- off position for membership is the absence of the row. A caller that omits the role
  -- has not decided yet, and should be told so by an error rather than quietly given the
  -- level this migration happened to pick.
  --
  -- Mockup 17 labels these Owner / Maintainer / Viewer / Service. Those are display
  -- strings for a screen that also shows an Okta sync this schema does not model; the
  -- four stored here are the ones the ticket specifies, and text-with-check is precisely
  -- what makes reconciling the two later an additive migration.
  role        text        not null,

  -- When the invitation was issued. Not nullable: every membership begins with somebody
  -- being asked, including a tenant's founding owner, whose invitation and acceptance are
  -- simply the same instant.
  invited_at  timestamptz not null default now(),

  -- When it was accepted. Null means the invitation is outstanding — a real state the
  -- member list has to render, and the reason this is not defaulted to `now()`.
  joined_at   timestamptz,

  updated_at  timestamptz not null default now(),

  -- Acceptance criterion: the same user cannot join a tenant twice. See the header for
  -- why this is the primary key rather than a unique constraint beside a surrogate id.
  constraint tenant_members_pkey primary key (tenant_id, user_id),

  constraint tenant_members_role_valid
    check (role in ('owner', 'admin', 'member', 'viewer')),

  -- Nobody accepts an invitation before it is sent. Cheap to state, and it catches a
  -- backfill or an import that fills the two columns from different sources.
  constraint tenant_members_joined_after_invited
    check (joined_at is null or joined_at >= invited_at)
);

comment on table ouroboros.tenant_members is
  'A person''s role in one tenant. Keyed on the (tenant_id, user_id) pair, so a user cannot join a tenant twice.';
comment on column ouroboros.tenant_members.role is
  'owner | admin | member | viewer. Text with a CHECK rather than an enum so a further role is an additive migration.';
comment on column ouroboros.tenant_members.invited_at is
  'When the invitation was issued. Also the row''s creation time — there is deliberately no separate created_at.';
comment on column ouroboros.tenant_members.joined_at is
  'When the invitation was accepted; null while it is still outstanding.';

-- "Which tenants does this person belong to" — the tenant switcher mockup 01 step 2
-- populates at sign-in. The primary key's leading column is `tenant_id`, so it cannot
-- answer this and a second index is genuinely needed here, unlike V003's tables.
create index tenant_members_user_id_idx
  on ouroboros.tenant_members (user_id);

create trigger tenant_members_touch_updated_at
  before update on ouroboros.tenant_members
  for each row execute function ouroboros.touch_updated_at();
