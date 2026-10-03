-- V090__workspace_lifecycle.sql — the Danger zone as mechanism: pause, delete, purge (#489, BR.5).
--
-- Mockup 17's Danger zone card makes three promises, and this migration stores the state each of
-- them needs:
--
--   1. **`workspace_lifecycle`** — the organization state `active | paused | pending_delete`.
--      Every dispatch point consults it: farm dispatch (AH.4, #252), stage advancement and run
--      opening (AP.1, #303). A workspace with no row is `active`, so this migration needs no
--      backfill and a workspace created tomorrow needs no insert. `pending_delete` carries the
--      instant its 30-day recovery window closes, and only `pending_delete` carries one.
--   2. **`audit_event_outbox`** — one row per lifecycle event, written in the same transaction as
--      its audit row, under the `audit.*` webhook family. Outbound delivery is BR.3 (#487); it
--      drains this table rather than inventing a second emitter. It has **no foreign key** to the
--      workspace on purpose: `audit.workspace.purged` is written after the workspace is gone, and
--      a cascade would take the one event a subscriber most needs to hear.
--   3. **`workspace_tombstones`** — the record a purge leaves behind, kept deliberately: which
--      workspace, who asked, when it was purged, how many key versions were destroyed and how many
--      rows were left (the purge asserts zero). Also without a foreign key, for the same reason.
--
-- The DEK destruction itself needs no schema: `tenant_keys` (V013) already holds every version
-- of a workspace's sealed DEK, and deleting those rows is what makes the workspace's ciphertext
-- unreadable — in backups too, once the KEK those backups' key rows were sealed under is retired
-- or the backups age out (docs/SECURITY_MODEL.md §2.6).

-- ---------------------------------------------------------------------------
-- 1. workspace_lifecycle — the organization state.
-- ---------------------------------------------------------------------------
create table ouroboros.workspace_lifecycle (
  organization_id text        primary key
                              references ouroboros.organization ("id") on delete cascade,

  state           text        not null
                              constraint workspace_lifecycle_state_known
                                check (state in ('active', 'paused', 'pending_delete')),

  -- Who moved it last, and when. Set null when the person is removed: the audit trail keeps
  -- the full history, and this row is only the current state.
  changed_by      text        references ouroboros."user" ("id") on delete set null,
  changed_at      timestamptz not null default now(),

  -- When the recovery window closes. Present exactly while the workspace is pending deletion.
  purge_after     timestamptz,

  constraint workspace_lifecycle_purge_after_iff_pending
    check ((state = 'pending_delete') = (purge_after is not null))
);

-- The purge sweep's read: every workspace whose window has closed.
create index workspace_lifecycle_due_idx
  on ouroboros.workspace_lifecycle (purge_after)
  where state = 'pending_delete';

comment on table ouroboros.workspace_lifecycle is
  'The organization state (#489): active, paused or pending_delete. No row means active. Farm dispatch, stage advancement and run opening consult it — while paused, work in flight finishes its stage and nothing new starts.';
comment on column ouroboros.workspace_lifecycle.purge_after is
  'When the 30-day recovery window closes and the scheduled purge may run. Non-null exactly when state = pending_delete.';

grant select, insert, update on ouroboros.workspace_lifecycle to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 2. audit_event_outbox — lifecycle events awaiting outbound delivery (BR.3).
-- ---------------------------------------------------------------------------
create table ouroboros.audit_event_outbox (
  id              uuid        primary key default gen_random_uuid(),

  -- Deliberately not a foreign key — see the header.
  organization_id text        not null,

  -- `audit.workspace.paused` and its siblings: the webhook family, then the audit action.
  event_type      text        not null
                              constraint audit_event_outbox_event_type_grammar
                                check (event_type ~ '^audit\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),

  payload         jsonb       not null
                              constraint audit_event_outbox_payload_object
                                check (jsonb_typeof(payload) = 'object'),

  occurred_at     timestamptz not null default now(),

  -- Set by BR.3's deliverer once every subscribed endpoint has the event.
  delivered_at    timestamptz
);

create index audit_event_outbox_undelivered_idx
  on ouroboros.audit_event_outbox (occurred_at)
  where delivered_at is null;

create index audit_event_outbox_organization_idx
  on ouroboros.audit_event_outbox (organization_id, occurred_at);

comment on table ouroboros.audit_event_outbox is
  'Events of the audit.* webhook family awaiting delivery (#489). Written in the transaction of the audit row they mirror; BR.3 (#487) delivers from here. No foreign key to organization: audit.workspace.purged is written after the workspace is gone.';

grant select, insert, update, delete on ouroboros.audit_event_outbox to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 3. workspace_tombstones — what a purge leaves behind, on purpose.
-- ---------------------------------------------------------------------------
create table ouroboros.workspace_tombstones (
  -- Not a foreign key: the workspace no longer exists.
  organization_id        text        primary key,
  name                   text        not null,
  slug                   text,

  requested_by           text,
  requested_at           timestamptz not null,
  purged_at              timestamptz not null default now(),

  dek_versions_destroyed integer     not null
                                     constraint workspace_tombstones_dek_versions_nonnegative
                                       check (dek_versions_destroyed >= 0),
  artifacts_deleted      integer     not null
                                     constraint workspace_tombstones_artifacts_nonnegative
                                       check (artifacts_deleted >= 0),
  rows_remaining         integer     not null
                                     constraint workspace_tombstones_rows_remaining_nonnegative
                                       check (rows_remaining >= 0)
);

comment on table ouroboros.workspace_tombstones is
  'The completion record of a workspace purge (#489), kept deliberately: the tenant''s DEK was destroyed (dek_versions_destroyed), its artifact objects deleted and its rows removed (rows_remaining, which the purge asserts is zero). Holds no tenant data beyond the workspace''s name and slug.';

grant select, insert on ouroboros.workspace_tombstones to ouroboros_app;
