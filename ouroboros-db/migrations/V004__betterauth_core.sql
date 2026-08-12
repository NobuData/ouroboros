-- V004__betterauth_core.sql — BetterAuth's four core tables, and the identities that move into them.
--
-- Ported from `@better-auth/cli generate`, not transcribed from documentation. The command
-- is written down in ouroboros-rest/README.md § Generating the auth schema and reads
-- `ouroboros-rest/src/auth/auth.config.ts` — the standalone instance #700 built for exactly
-- this purpose:
--
--   npx @better-auth/cli@1.4.21 generate --config src/auth/auth.config.ts --output V004.sql
--
-- Its output is reproduced below statement for statement, with three deliberate additions
-- marked `-- OURS`: the schema qualification, the two indexes the roadmap asks for that the
-- library does not emit, and the back-fill at the foot of the file. Nothing else is
-- reshaped. Roadmap decision **A4** is why: these are vendor-shaped tables and they keep
-- vendor naming — quoted camelCase columns, singular table names — because renaming them
-- would put this schema at war with every BetterAuth upgrade and every plugin that reads
-- them. The house snake_case style still governs *our* tables (V001–V003), which is where
-- the two conventions meet and stop.
--
-- **`user` is a reserved word in SQL, so it is quoted at every single occurrence.**
-- `ouroboros."user"`, never `ouroboros.user` — the second parses as the `user` keyword and
-- fails, or worse, resolves somewhere unintended. It differs from V002's shipped `users`
-- table by one letter, which is precisely why the rule has to be mechanical rather than
-- remembered: `scripts/verify-dev-env.sh` greps every migration for an unquoted `user` in a
-- table position and fails `ci/db` before PostgreSQL ever sees it.
--
-- **Flyway remains the only thing that issues DDL** (decision **A3**). BetterAuth ships a
-- `migrate` command that would create these tables itself; it is never run, and
-- `scripts/verify-dev-env.sh` asserts no script or workflow in this repository invokes it.
-- The service reads and writes these tables and creates none of them.
--
-- ---------------------------------------------------------------------------
-- What this migration does to a database that already has rows in it
-- ---------------------------------------------------------------------------
--
-- V002 shipped `users` and `user_identities` and they are populated: R__dev_seed.sql fills
-- them in development, and #33's GitHub sign-in has been writing them in earnest. Two
-- tables now describe the same people — `users` and `"user"` — and if the new ones started
-- empty, every person who has ever signed in would arrive at their next sign-in as a
-- stranger, with a second account and none of their memberships.
--
-- So the DDL is followed by a back-fill: `users` → `"user"` and `user_identities` →
-- `account`, **preserving ids**. `tenant_members.user_id` and every other foreign key
-- written against `users.id` therefore still resolves, and `"user".id` holds the same value
-- spelled as text — which is what makes #708's cut-over a rename rather than a remapping.
--
-- The old tables are **not dropped here**. That is #708, deliberately: until #702 has landed
-- and been exercised, pointing traffic back at `users`/`user_identities` has to remain a
-- possibility, and a migration that had already dropped them would make reverting a restore
-- from backup.
--
-- One consequence worth stating rather than discovering. On a database created *from empty*
-- Flyway applies this migration before R__dev_seed.sql — repeatable migrations run last —
-- so the back-fill copies nothing and the seed then fills `users`/`user_identities` alone.
-- That is correct for what this migration is (a one-time move of existing rows) and it
-- leaves a development database whose demo people cannot sign in through BetterAuth until
-- #709 teaches the seed about these tables. Call
-- `ouroboros.backfill_betterauth_core()` by hand to bring such a database across in the
-- meantime; it is idempotent, which is the whole reason the back-fill is a function.
--
-- Filed as issue #706.

-- ---------------------------------------------------------------------------
-- "user" — the person, as BetterAuth holds them.
--
-- Emitted by the CLI as:
--   create table "user" ("id" text not null primary key, "name" text not null,
--     "email" text not null unique, "emailVerified" boolean not null, "image" text,
--     "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
--     "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
--
-- `id` is `text` rather than `uuid` because the library generates its own ids and does not
-- promise they are uuids. V002's `users.id` is a uuid, and a uuid renders to text without
-- loss — which is what lets the back-fill below preserve them exactly.
-- ---------------------------------------------------------------------------
create table ouroboros."user" (
  "id"            text        not null primary key,
  "name"          text        not null,
  "email"         text        not null unique,
  "emailVerified" boolean     not null,
  "image"         text,
  "createdAt"     timestamptz not null default current_timestamp,
  "updatedAt"     timestamptz not null default current_timestamp
);

comment on table ouroboros."user" is
  'BetterAuth core: the person. Quoted at every reference — user is a reserved word. Supersedes ouroboros.users, which #708 drops.';
comment on column ouroboros."user"."email" is
  'Unique across the installation, stored lower-cased by the library. Account linking matches on it.';
comment on column ouroboros."user"."emailVerified" is
  'Whether the address has been proved. Back-filled true only for people who arrived through a provider that verifies it.';

-- ---------------------------------------------------------------------------
-- session — one row per live sign-in, which is what makes sign-out mean something.
--
-- Emitted by the CLI as:
--   create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null,
--     "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
--     "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text,
--     "userId" text not null references "user" ("id") on delete cascade);
--
-- `updatedAt` carries no default, unlike `"user"`'s. That is the library's own shape rather
-- than an omission here — it writes the column on every insert — and it is left alone so a
-- drift check (#710) compares like with like.
--
-- Nothing writes this table until #703 turns database-backed sessions on; it lands here
-- because Flyway owns the DDL and A.4 must not need a migration of its own to start.
-- ---------------------------------------------------------------------------
create table ouroboros.session (
  "id"        text        not null primary key,
  "expiresAt" timestamptz not null,
  "token"     text        not null unique,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  -- Cascade: deleting a person ends their sessions in the same statement. Without it a
  -- session row would outlive its user and every request carrying it would resolve to
  -- nobody, which is a 500 rather than a sign-out.
  "userId"    text        not null references ouroboros."user" ("id") on delete cascade
);

comment on table ouroboros.session is
  'BetterAuth core: one row per live session. Revocation is deleting the row — the property #33''s stateless cookie could not offer.';
comment on column ouroboros.session."token" is
  'The value the session cookie carries. Unique, and the lookup every authenticated request makes.';

-- ---------------------------------------------------------------------------
-- account — how a person proves who they are: an external provider, or a password.
--
-- Emitted by the CLI as:
--   create table "account" ("id" text not null primary key, "accountId" text not null,
--     "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade,
--     "accessToken" text, "refreshToken" text, "idToken" text,
--     "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
--     "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
--     "updatedAt" timestamptz not null);
--
-- This is the one table in the schema that holds credentials, and that is a change of
-- policy worth naming. V002's header forbids a token on `user_identities` and
-- tests/constraints.sql enforces the absence by reading information_schema. That rule was
-- written for *our* table and stands for it; this is the library's table, the columns are
-- part of its contract, and BetterAuth encrypts `accessToken`/`refreshToken` with
-- `BETTER_AUTH_SECRET` before they are written. `password` is a hash, and only #705's
-- development email/password sign-in ever fills it. The constraint suite's credential
-- assertions are scoped to the tenancy tables for exactly this reason.
-- ---------------------------------------------------------------------------
create table ouroboros.account (
  "id"                    text        not null primary key,

  -- The provider's own id for the account — GitHub's numeric user id, not the renameable
  -- login. Same value V002's `user_identities.external_id` holds, and the back-fill moves
  -- it across unchanged.
  "accountId"             text        not null,

  -- Which provider issued it: `github` today, `credential` once #705 lands.
  "providerId"            text        not null,

  "userId"                text        not null references ouroboros."user" ("id") on delete cascade,

  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz not null default current_timestamp,
  "updatedAt"             timestamptz not null
);

comment on table ouroboros.account is
  'BetterAuth core: one row per way a person can sign in. Holds provider tokens, encrypted by the library with BETTER_AUTH_SECRET.';
comment on column ouroboros.account."accountId" is
  'The provider''s immutable id for the account — GitHub''s numeric user id. Unique with providerId.';

-- ---------------------------------------------------------------------------
-- verification — short-lived one-time values: email verification, password reset.
--
-- Emitted by the CLI as:
--   create table "verification" ("id" text not null primary key, "identifier" text not null,
--     "value" text not null, "expiresAt" timestamptz not null,
--     "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
--     "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
--
-- Unused until #705. Created now because the library expects all four of its core tables to
-- exist and probes them, and a table absent from a schema Flyway owns is a runtime error
-- rather than a missing feature.
-- ---------------------------------------------------------------------------
create table ouroboros.verification (
  "id"         text        not null primary key,
  "identifier" text        not null,
  "value"      text        not null,
  "expiresAt"  timestamptz not null,
  "createdAt"  timestamptz not null default current_timestamp,
  "updatedAt"  timestamptz not null default current_timestamp
);

comment on table ouroboros.verification is
  'BetterAuth core: one-time values with an expiry — email verification and password reset. Unused until #705.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- The first three are the CLI's own. The fourth is ours, and it is the one the roadmap
-- names: without it two people could hold the same GitHub account.
--
-- `"user".email` and `session.token` are unique already — the inline `unique` above builds
-- `user_email_key` and `session_token_key` — so the acceptance criterion's third uniqueness
-- rule is the only one that needs a statement of its own.
-- ---------------------------------------------------------------------------
create index "session_userId_idx"        on ouroboros.session ("userId");
create index "account_userId_idx"        on ouroboros.account ("userId");
create index verification_identifier_idx on ouroboros.verification ("identifier");

-- OURS. One external account belongs to one person: `findOAuthUser` looks a sign-in up by
-- exactly this pair, and a duplicate would make "which person is this" a question with two
-- answers. It is the successor to V002's `user_identities_provider_external_id_key`, and
-- the back-fill below depends on it — it is what makes copying the same identity twice
-- impossible rather than merely unlikely.
create unique index account_provider_account_key
  on ouroboros.account ("providerId", "accountId");

-- ---------------------------------------------------------------------------
-- The back-fill.
--
-- OURS, all of it. A function rather than four bare statements for three reasons: it is
-- idempotent, so a database that met this migration with the tables half-populated
-- converges rather than fails; it can be run again by hand on a development database the
-- seed filled after the fact (see this file's header); and it is callable from
-- tests/constraints.sql, which is what lets `ci/db` assert the row counts and the preserved
-- ids against fixtures instead of trusting them.
--
-- #708 drops it along with the tables it reads.
-- ---------------------------------------------------------------------------
create function ouroboros.backfill_betterauth_core()
returns table (users_copied bigint, accounts_copied bigint)
language plpgsql as $$
declare
  copied_users    bigint;
  copied_accounts bigint;
begin
  -- `users` → `"user"`, id for id.
  --
  -- `emailVerified` is the one field with no source column, and it is not defaulted to a
  -- convenient value. A person holding a GitHub identity got here through #33's flow, which
  -- accepted only a *verified* primary address from GitHub (`github.ts` refuses an account
  -- offering none) — so `true` is a fact about them. A person with no identity was created
  -- by an invitation (#31) and has never proved anything, so `false` is the honest answer.
  -- It matters: BetterAuth's account linking consults this column.
  insert into ouroboros."user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt")
  select
    u.id::text,
    u.display_name,
    u.email,
    exists (
      select 1 from ouroboros.user_identities i
      where i.user_id = u.id and i.provider = 'github'
    ),
    u.avatar_url,
    u.created_at,
    u.updated_at
  from ouroboros.users u
  -- Skipped rather than upserted, on both keys. A row already carrying this id is this
  -- person, already moved; a row already carrying this address is this person under an id
  -- BetterAuth minted for them, and overwriting either would be this migration deciding
  -- which of two live records wins. Doing nothing leaves that to a human, and leaves the
  -- counts below telling them it happened.
  where not exists (
    select 1 from ouroboros."user" b
    where b."id" = u.id::text or b."email" = u.email
  );
  get diagnostics copied_users = row_count;

  -- `user_identities` → `account`, id for id.
  --
  -- No token is copied, because V002 never stored one — its header forbids it. An account
  -- row with a null `accessToken` is exactly right: the person is recognised, and the next
  -- sign-in fills the token in.
  insert into ouroboros.account ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
  select
    i.id::text,
    i.external_id,
    -- V002's `provider` and BetterAuth's `providerId` happen to agree on the spelling
    -- `github`. Written out rather than copied through so the day a second provider is
    -- added is the day this line has to be looked at.
    'github',
    i.user_id::text,
    i.created_at,
    i.updated_at
  from ouroboros.user_identities i
  where i.provider = 'github'
    -- The foreign key, checked before it is violated: an identity whose person did not
    -- come across (skipped above, or deleted between the two statements) is left behind
    -- with a count that does not match, which is a report rather than a failed migration.
    and exists (select 1 from ouroboros."user" b where b."id" = i.user_id::text)
    and not exists (
      select 1 from ouroboros.account a
      where a."id" = i.id::text
         or (a."providerId" = 'github' and a."accountId" = i.external_id)
    );
  get diagnostics copied_accounts = row_count;

  return query select copied_users, copied_accounts;
end;
$$;

comment on function ouroboros.backfill_betterauth_core() is
  'Copies ouroboros.users and ouroboros.user_identities into the BetterAuth core tables, preserving ids. Idempotent; dropped by #708 with the tables it reads.';

-- Run it, and say what it did. The notice is the only record a developer or a CI log gets
-- of how many people this migration moved, and "0 rows, 0 rows" on a database created from
-- empty is the expected reading rather than a warning.
do $$
declare
  moved record;
begin
  select * into moved from ouroboros.backfill_betterauth_core();
  raise notice 'V004 back-filled % user row(s) and % account row(s) from the V002 tables',
    moved.users_copied, moved.accounts_copied;
end
$$;
