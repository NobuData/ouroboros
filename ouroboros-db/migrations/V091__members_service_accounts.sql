-- V091__members_service_accounts.sql — members capabilities, service accounts and their tokens (#485, BR.1).
--
-- Mockup 17's Members & Roles card has four columns, and decision S3 makes every one of them
-- enforceable data. Roles stay the BetterAuth organization plugin's (`member.role`, V005) — this
-- migration adds **no second role table** — and the rest is stored here:
--
--   1. **`member_capabilities`** — the per-member `can_approve_loops` capability. A member with
--      no row holds the default their role implies (owner and admin yes, member and viewer no);
--      a row is an explicit setting and survives role changes. The PR plane's approve, waive and
--      merge routes read it, and the inbox's approve-class actions (#464) will.
--   2. **`service_accounts`** — non-human principals (`devops-bot`). Each holds a list of scopes
--      drawn from a registered allow-list of API surfaces, constrained here as well as in REST so
--      a scope nobody enforces cannot be stored.
--   3. **`service_tokens`** — the bearer secrets. **Hash-only**: `token_hash` is the SHA-256 of
--      the token and the token itself is never stored. The masked hint the card shows
--      (`orb_svc_••••ab12`) is sealed with the workspace's DEK (AD.1, #222), so even the four
--      characters live under the vault. At most one live token per account; rotation revokes
--      the old one in the same transaction it mints the new one.
--   4. **`audit_events.actor_service`** — the service account a request was authenticated as,
--      so the trail can say `service:devops-bot` instead of borrowing a person (#225 actor kinds).
--      It is a name, not a foreign key: the trail is append-only and must outlive the account.

-- ---------------------------------------------------------------------------
-- 1. member_capabilities — explicit per-member capability settings.
-- ---------------------------------------------------------------------------
create table ouroboros.member_capabilities (
  member_id         text        primary key
                                references ouroboros.member ("id") on delete cascade,

  -- Denormalised from member so the purge's leftover count (and every per-workspace read) can
  -- scope by workspace without a join; the cascade from organization deletes it either way.
  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,

  can_approve_loops boolean     not null,

  -- Who set it last. Set null when the person is removed; the audit trail keeps the history.
  updated_by        text        references ouroboros."user" ("id") on delete set null,
  updated_at        timestamptz not null default now()
);

create index member_capabilities_organization_idx
  on ouroboros.member_capabilities (organization_id);

comment on table ouroboros.member_capabilities is
  'Explicit per-member capabilities (#485, decision S3). No row means the role default: owner and admin may approve loops, member and viewer may not. A row survives role changes, so an administrator''s untick is never silently undone.';
comment on column ouroboros.member_capabilities.can_approve_loops is
  'Whether the member may approve, waive and merge on the PR plane (and approve-class inbox actions, #464). Checked at the route, not merely displayed.';

grant select, insert, update, delete on ouroboros.member_capabilities to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 2. service_accounts — non-human principals.
-- ---------------------------------------------------------------------------
create table ouroboros.service_accounts (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- `devops-bot`: lower-case, digits and hyphens, 3–40 characters. It is what the audit trail
  -- prints after `service:`, so it is constrained to something that prints cleanly.
  name            text        not null
                              constraint service_accounts_name_grammar
                                check (name ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'),

  -- The registered allow-list (REST `service.scopes.ts`). A new scope is a migration and a
  -- route that enforces it, never one without the other.
  scopes          jsonb       not null default '[]'::jsonb
                              constraint service_accounts_scopes_array
                                check (jsonb_typeof(scopes) = 'array')
                              constraint service_accounts_scopes_registered
                                check (scopes <@ '["api.read", "farm.submit"]'::jsonb),

  created_by      text        references ouroboros."user" ("id") on delete set null,
  created_at      timestamptz not null default now(),

  -- Set by revoke. A disabled account authenticates nothing and cannot be rotated.
  disabled_at     timestamptz,

  constraint service_accounts_name_unique unique (organization_id, name)
);

comment on table ouroboros.service_accounts is
  'Non-human principals (#485): automation authenticates as itself rather than borrowing a person''s session, and is audited as service:<name>. Scopes are an allow-list of API surfaces, enforced at the route.';

grant select, insert, update, delete on ouroboros.service_accounts to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 3. service_tokens — hash-only bearer secrets.
-- ---------------------------------------------------------------------------
create table ouroboros.service_tokens (
  id                 uuid        primary key default gen_random_uuid(),

  organization_id    text        not null
                                 references ouroboros.organization ("id") on delete cascade,
  service_account_id uuid        not null
                                 references ouroboros.service_accounts ("id") on delete cascade,

  -- SHA-256 of the token, lower-case hex. The token itself is never stored.
  token_hash         text        not null
                                 constraint service_tokens_hash_hex
                                   check (token_hash ~ '^[0-9a-f]{64}$'),

  -- The masked display form, sealed under the workspace DEK (an AD.1 envelope).
  hint_sealed        text        not null
                                 constraint service_tokens_hint_envelope
                                   check (hint_sealed like 'ouro.v1.%'),

  created_by         text        references ouroboros."user" ("id") on delete set null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,

  constraint service_tokens_hash_unique unique (token_hash)
);

-- At most one live token per account: rotation revokes before it inserts.
create unique index service_tokens_one_live_idx
  on ouroboros.service_tokens (service_account_id)
  where revoked_at is null;

create index service_tokens_organization_idx
  on ouroboros.service_tokens (organization_id);

comment on table ouroboros.service_tokens is
  'Service account bearer tokens (#485). Hash-only: token_hash is SHA-256 of the token, which is shown once at creation or rotation and never stored. hint_sealed is the masked form, sealed under the workspace DEK.';

grant select, insert, update, delete on ouroboros.service_tokens to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 4. audit_events.actor_service — service accounts as audit actors.
-- ---------------------------------------------------------------------------
alter table ouroboros.audit_events
  add column actor_service text
    constraint audit_events_actor_service_grammar
      check (actor_service ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'),
  -- A service request has no person behind it: the two attributions are exclusive.
  add constraint audit_events_actor_exclusive
    check (actor_service is null or actor_id is null);

comment on column ouroboros.audit_events.actor_service is
  'The service account the request was authenticated as (#485), rendered service:<name>. A name rather than a foreign key: the trail outlives the account. Exclusive with actor_id.';

-- The append-only trigger compares an explicit column list (V022), so the new column has to
-- join it — otherwise an UPDATE could rewrite who a service event was attributed to.
create or replace function ouroboros.audit_events_refuse_update() returns trigger
language plpgsql
as $$
begin
  -- The one update this table permits, and it is not a revision: `actor_id` going from a
  -- person to null, with every other column untouched (V022 explains why).
  if new.actor_id is null and old.actor_id is not null
     and row(new.id, new.organization_id, new.action, new.subject_type,
             new.subject_id, new.ip, new.detail, new.occurred_at, new.actor_service)
         is not distinct from
         row(old.id, old.organization_id, old.action, old.subject_type,
             old.subject_id, old.ip, old.detail, old.occurred_at, old.actor_service)
  then
    return new;
  end if;

  raise exception
    'ouroboros.audit_events is append-only: an audit event cannot be revised'
    using errcode = 'restrict_violation',
          detail  = format('refused update of event %s (%s) in organization %s',
                           old.id, old.action, old.organization_id),
          hint    = 'Record a correcting event instead; only actor_id may be cleared, and only by the foreign key''s own set-null. See V022__audit_events.sql (#225).';
end;
$$;
