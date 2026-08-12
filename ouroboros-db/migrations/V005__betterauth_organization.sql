-- V005__betterauth_organization.sql — the organization plugin's three tables, and the
-- column on `session` that makes one of them the tenant a request is acting in.
--
-- Ported from `@better-auth/cli generate`, not transcribed from documentation, exactly as
-- V004 was. The command is written down in ouroboros-rest/README.md § Generating the auth
-- schema; for this migration it was run against a copy of `src/auth/auth.config.ts` with
-- the organization plugin added, because the plugin is #704's to land and the DDL has to
-- exist first:
--
--   npx @better-auth/cli@1.4.21 generate --config src/auth/auth.config.ts --output V005.sql
--
-- Its output is reproduced below statement for statement, with the additions marked
-- `-- OURS` and argued for where they appear. Everything else — the singular table names,
-- the quoted camelCase columns, `metadata` as `text` — is the library's shape and is kept
-- exactly, which is roadmap decision **A4**. The house snake_case style still governs
-- V001–V003.
--
-- **Flyway remains the only thing that issues DDL** (decision **A3**). The plugin creates
-- none of these tables; it reads and writes them and fails loudly if they are absent,
-- which is why this migration lands before #704 rather than beside it.
--
-- ---------------------------------------------------------------------------
-- What these three tables are for
-- ---------------------------------------------------------------------------
--
-- `docs/mockups/01-login.html` Step 2 — *"Choose where the loop runs"* — is a list of
-- organizations with a role beside each and one of them selected. That sentence names all
-- four things here:
--
--   * **`organization`** — the workspace. The successor to V001's `tenants`, which #708
--     migrates across and drops. `metadata` carries the `personal` flag the mockup renders
--     as a pill.
--   * **`member`** — the pairing of a person with an organization, and their role in it.
--     The successor to V002's `tenant_members`, whose `owner|admin|member|viewer`
--     vocabulary #704 reproduces so that #708's migration is a rename rather than a
--     re-think.
--   * **`invitation`** — somebody asked to join who has not yet. Written at the API level
--     in MVP; #724 adds the email that delivers it, which is why `expiresAt` is here now.
--   * **`session."activeOrganizationId"`** — *which* organization the caller is acting in.
--     This is the one that changes how the service works rather than what it stores: the
--     tenant stops being a header the client asserts (`X-Ouro-Tenant`, which #32 shipped
--     and #713 demotes) and becomes a column on the session row, which only the server
--     can write. Decision **A5**.
--
-- ---------------------------------------------------------------------------
-- Order, and why it differs from the generated file
-- ---------------------------------------------------------------------------
--
-- The CLI emits its `alter table "session"` first, because the column it adds carries no
-- foreign key and so depends on nothing. Ours does (see below), so the statement is moved
-- to the foot of this file, after the table it references exists. That is the only
-- resequencing; every statement is otherwise in the order it was generated.
--
-- Filed as issue #707.

-- ---------------------------------------------------------------------------
-- organization — the workspace. The root the two tables below cascade from.
--
-- Emitted by the CLI as:
--   create table "organization" ("id" text not null primary key, "name" text not null,
--     "slug" text not null unique, "logo" text,
--     "createdAt" timestamptz not null, "metadata" text);
--
-- `id` is `text` for the same reason `"user".id` is: the library mints its own ids and does
-- not promise they are uuids. V001's `tenants.id` *is* a uuid, and a uuid renders to text
-- without loss — which is what will let #708 carry the ids across unchanged rather than
-- build a mapping table for them.
--
-- There is no `updatedAt`, and no `ouroboros.touch_updated_at()` trigger is attached. Both
-- are deliberate: the plugin's schema declares no such column, and adding one would be a
-- column the library never writes and every future `generate` would report as drift
-- (#710).
-- ---------------------------------------------------------------------------
create table ouroboros.organization (
  "id"        text        not null primary key,

  -- What a human reads. Free text, like V001's `display_name`.
  "name"      text        not null,

  -- The URL- and CLI-safe handle, unique across the installation. V001 constrained its
  -- `tenants.slug` to a DNS label shape; this one is not constrained here, because the
  -- plugin generates slugs itself and validates what a caller supplies before writing it.
  -- A check constraint that disagreed with the library's own rule by one character would
  -- surface as a 500 on organization creation rather than as the 400 the plugin already
  -- returns.
  "slug"      text        not null unique,

  -- The organization's avatar, as a URL. Null until one is set. Unlike V002's
  -- `users.avatar_url` this carries no http(s) allow-list, for the reason above: it is the
  -- library's column and the library validates it. `ouroboros-ui` escapes at render time,
  -- which is where that protection actually belongs.
  "logo"      text,

  "createdAt" timestamptz not null,

  -- **JSON, held as text, and it has to stay text.** The plugin writes
  -- `JSON.stringify(metadata)` and reads it back with `JSON.parse` only when the value it
  -- gets is a *string* (`plugins/organization/adapter.mjs`). A `jsonb` column would apply
  -- cleanly, accept every write, and then hand the library an object it does not parse —
  -- so `metadata.personal` would read as undefined and mockup 01's `personal` pill would
  -- stop rendering, with nothing failing anywhere to say why. It looks like an obvious
  -- improvement and it is a silent break; that is why this comment is here.
  --
  -- What it holds today is one flag: `{"personal": true}` on the organization created for
  -- somebody at their first sign-in. #704 writes it, mockup 01 Step 2 renders it.
  "metadata"  text,

  -- OURS. The column is JSON text by contract, so a value that is not JSON is a row the
  -- library will throw on the next time it reads the organization. `is json` is
  -- PostgreSQL 16+'s non-throwing predicate — it answers false rather than raising, which
  -- is what lets this be a check constraint at all.
  --
  -- Deliberately `is json` rather than `is json object`: the plugin only ever writes an
  -- object, but a caller clearing the field can reach the adapter with `JSON.stringify(null)`
  -- — the text `null`, which is valid JSON and not an object. Rejecting that would be this
  -- constraint inventing a rule the library does not have. What it does reject is a hand
  -- -written insert putting a bare word or a fragment there, which is the failure that
  -- would actually happen.
  --
  -- It constrains *shape*, not vocabulary, which is why it is safe against library
  -- upgrades in a way a `check (status in (…))` would not be — see `invitation.status`.
  constraint organization_metadata_is_json
    check ("metadata" is null or "metadata" is json)
);

comment on table ouroboros.organization is
  'BetterAuth organization plugin: the workspace. Supersedes ouroboros.tenants, which #708 migrates across and drops.';
comment on column ouroboros.organization."slug" is
  'URL-safe handle, unique across the installation. Generated and validated by the plugin, not by a check constraint here.';
comment on column ouroboros.organization."metadata" is
  'JSON held as text — the library stringifies on write and parses on read, so jsonb would silently break it. Carries {"personal": true} for the organization created at first sign-in (#704).';

-- ---------------------------------------------------------------------------
-- member — a person's role in one organization.
--
-- Emitted by the CLI as:
--   create table "member" ("id" text not null primary key,
--     "organizationId" text not null references "organization" ("id") on delete cascade,
--     "userId" text not null references "user" ("id") on delete cascade,
--     "role" text not null, "createdAt" timestamptz not null);
--
-- Both cascades are the library's own and both are right. Deleting an organization removes
-- the memberships in it and leaves the people; deleting a person removes their
-- memberships and leaves the organizations. That is V002's rule for `tenant_members`
-- restated by a different author, which is a good sign for #708.
--
-- The surrogate `id` is the difference from `tenant_members`, whose primary key *was* the
-- `(tenant_id, user_id)` pair. The library addresses a membership by a single id — its
-- `removeMember` and `updateMemberRole` routes take one — so the pair moves from being the
-- key to being a unique constraint. See below; that is not a weakening.
-- ---------------------------------------------------------------------------
create table ouroboros.member (
  "id"             text        not null primary key,

  "organizationId" text        not null references ouroboros.organization ("id") on delete cascade,

  -- Quoted `"user"`, like every other reference to that table in this repository: unquoted,
  -- `ouroboros.user` parses as the `user` keyword, and it is one letter from `users`, which
  -- is a real table that would happily answer. `scripts/verify-dev-env.sh` fails `ci/db` on
  -- an unquoted one before PostgreSQL ever sees this file.
  "userId"         text        not null references ouroboros."user" ("id") on delete cascade,

  -- What they may do here — `owner`, `admin`, `member`, or the custom `viewer` #704 adds.
  --
  -- **Not CHECK-constrained**, and that is a change from V002's `tenant_members.role`,
  -- which was. The vocabulary is the plugin's now, and it is configuration rather than
  -- schema: #704 defines `viewer` in an access-control statement, #724 may add another,
  -- and the library accepts a comma-separated list here for a member holding two. A check
  -- constraint would have to be re-issued as a migration every time that configuration
  -- changed, and until it was it would reject a role the application had just been
  -- configured to grant — a 500 on "add member", for a rule the application already
  -- enforces where it is decided. The vocabulary is written down in the column comment
  -- below and asserted in ouroboros-rest, which is where it lives.
  "role"           text        not null,

  "createdAt"      timestamptz not null,

  -- OURS. The acceptance criterion, and the successor to `tenant_members`' composite
  -- primary key: one person holds one membership in one organization.
  --
  -- The plugin checks for an existing membership before it inserts — `addMember` and
  -- `acceptInvitation` both answer `USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION` — so
  -- this is not a rule the library fights. It is what makes the check *hold* under two
  -- concurrent accepts of two invitations to the same organization, which is a race the
  -- library's read-then-write cannot close by itself. Without it that race leaves one
  -- person in mockup 17's member list twice, with two independent roles and no way for the
  -- UI to say which one governs.
  --
  -- `("organizationId", "userId")` in that order rather than the reverse: the pair is
  -- enforced either way, but this order also serves "the members of this organization",
  -- which is mockup 17's list and the plugin's own `findMemberByOrgId` lookup.
  constraint member_organization_user_key unique ("organizationId", "userId")
);

comment on table ouroboros.member is
  'BetterAuth organization plugin: a person''s role in one organization. Supersedes ouroboros.tenant_members, which #708 migrates across and drops.';
comment on column ouroboros.member."role" is
  'owner | admin | member, plus the custom viewer role #704 adds — a comma-separated list where a member holds more than one. Deliberately not CHECK-constrained: the vocabulary is the plugin''s configuration, not this schema''s.';

-- ---------------------------------------------------------------------------
-- invitation — somebody asked to join, who has not joined yet.
--
-- Emitted by the CLI as:
--   create table "invitation" ("id" text not null primary key,
--     "organizationId" text not null references "organization" ("id") on delete cascade,
--     "email" text not null, "role" text, "status" text not null,
--     "expiresAt" timestamptz not null,
--     "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
--     "inviterId" text not null references "user" ("id") on delete cascade);
--
-- Written at the API level in MVP and never delivered: #724 is the email. It lands now
-- because the plugin's invitation routes are mounted the moment #704 enables it, and a
-- mounted route whose table does not exist is a 500 rather than an unimplemented feature.
--
-- `email` is not folded to lower case here, and it is the one place this schema departs
-- from V001/V002's "case-folded on the way in" convention. The convention is enforced by
-- check constraints on *our* tables; this is the library's, it matches an invitation to a
-- `"user"."email"` the library also owns, and a constraint that rejected what the library
-- wrote would make invitations impossible to create rather than merely inconsistent.
-- ---------------------------------------------------------------------------
create table ouroboros.invitation (
  "id"             text        not null primary key,

  "organizationId" text        not null references ouroboros.organization ("id") on delete cascade,

  -- Who was invited. An address rather than a user id, because the whole point is that
  -- they may not have an account yet — which is also why #702's account linking exists.
  "email"          text        not null,

  -- What they will hold when they accept. Nullable, unlike `member.role`: an invitation
  -- that names no role is accepted into the plugin's default, `member`.
  "role"           text,

  -- `pending`, `accepted`, `rejected` or `canceled` — the four the library writes.
  --
  -- **Not CHECK-constrained**, for the reason `member.role` is not: it is the library's
  -- vocabulary, an upgrade may add to it, and a constraint one release out of date would
  -- reject a state the library had just moved an invitation into. Note there is no
  -- `expired`, despite what a reading of this issue's diagram suggests — expiry is the
  -- `expiresAt` timestamp below, evaluated at accept time, not a status anything writes.
  -- #724 needs that distinction and it is easier to state here than to rediscover.
  "status"         text        not null,

  -- When it stops being acceptable. #724's, and the reason it is here rather than there.
  "expiresAt"      timestamptz not null,

  "createdAt"      timestamptz not null default current_timestamp,

  -- Who sent it. Cascades: deleting the person who invited somebody withdraws the
  -- invitation, which is the library's choice and a defensible one — an invitation whose
  -- inviter no longer exists is one nobody can vouch for.
  "inviterId"      text        not null references ouroboros."user" ("id") on delete cascade
);

comment on table ouroboros.invitation is
  'BetterAuth organization plugin: a pending request to join. Written at the API level in MVP; #724 delivers the email.';
comment on column ouroboros.invitation."status" is
  'pending | accepted | rejected | canceled — the library''s vocabulary. Expiry is the expiresAt timestamp, not a status.';
comment on column ouroboros.invitation."expiresAt" is
  'When the invitation stops being acceptable. Evaluated at accept time by the plugin; #724 is what makes it reachable by email.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- All five are the CLI's own, reproduced as emitted.
--
-- `organization_slug_uidx` duplicates the `unique` on the column above, which built
-- `organization_slug_key` — two unique indexes over one column, which is the library's
-- output rather than an oversight here. It is kept, and the reason is #710: a drift check
-- compares a fresh `generate` against what is applied, and a statement dropped for being
-- redundant is a difference that check has to be taught to forgive. One spare index on a
-- table with a row per workspace costs nothing worth that.
-- ---------------------------------------------------------------------------
create unique index "organization_slug_uidx"     on ouroboros.organization ("slug");
create index        "member_organizationId_idx"  on ouroboros.member ("organizationId");
create index        "member_userId_idx"          on ouroboros.member ("userId");
create index        "invitation_organizationId_idx" on ouroboros.invitation ("organizationId");
create index        "invitation_email_idx"       on ouroboros.invitation ("email");

-- ---------------------------------------------------------------------------
-- session."activeOrganizationId" — the tenant pointer.
--
-- Emitted by the CLI as:
--   alter table "session" add column "activeOrganizationId" text;
--
-- **OURS: the foreign key and its `on delete set null`.** The library emits a bare `text`
-- column, because its schema declares no reference for it — the plugin clears the pointer
-- in application code when it deletes an organization. That is a rule held in one place by
-- one code path, and the acceptance criterion asks for it in the schema instead. Three
-- things follow from writing it down here:
--
--   * A session can never point at an organization that does not exist. Without the key,
--     a `delete from organization` issued by anything other than the plugin — #708's
--     migration, a support script, `psql` — leaves every session in it pointing at a gone
--     id, and the next request resolves a tenant that cannot be read. That is a 500 on
--     every page, for everybody who was signed in.
--   * `on delete set null` rather than `cascade`, and the difference matters: **deleting an
--     organization must not sign its members out.** A cascade here would delete the
--     *session rows*, which is the tenant pointer taking the session with it. Null is the
--     honest state — signed in, acting nowhere — and it is exactly the state a new session
--     starts in and that #704's active-organization resolution already has to handle.
--   * It is nullable, because it must be. A session exists from the moment somebody signs
--     in, which is before they have chosen anything in mockup 01 Step 2 — and #704 creates
--     a personal organization at that moment precisely so the choice has a default rather
--     than because the column could not hold null.
--
-- `input: false` in the plugin's schema means the library never accepts this value from a
-- request body; it is written by `setActiveOrganization` and by the session-creation hook,
-- both server-side. The column is the server's, which is the whole of decision **A5**.
-- ---------------------------------------------------------------------------
alter table ouroboros.session
  add column "activeOrganizationId" text
    references ouroboros.organization ("id") on delete set null;

comment on column ouroboros.session."activeOrganizationId" is
  'Which organization this session is acting in — the tenant pointer (decision A5). Null until one is chosen. ON DELETE SET NULL: deleting an organization must not delete the sessions of the people who were in it.';

-- OURS. `where "activeOrganizationId" = $1` is not a query this service makes — the pointer
-- is read from a session already in hand, by primary key. What needs the index is the
-- foreign key itself: without one, every `delete from ouroboros.organization` scans
-- `session` in full to find the rows to null out, and `session` is the largest table in
-- this schema. #708 deletes organizations in bulk.
create index "session_activeOrganizationId_idx"
  on ouroboros.session ("activeOrganizationId");
