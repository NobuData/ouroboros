-- V100__decision_channels.sql — the two real decision channels: a GitHub mirror comment per item,
-- and email carrying single-use action tokens (#463, BN.3, decision X5).
--
-- ---------------------------------------------------------------------------
-- 1. action_token_keys — the key V096's token hashes are taken under.
-- ---------------------------------------------------------------------------
--
-- V096 stores `token_hash` as the HMAC-SHA256 of a token "under a key the vault holds", and
-- `hash_key_ref` names that key. This table is where the key lives: 32 random bytes per workspace,
-- **sealed by the workspace's DEK** (AD.1, #222) — `sealed_key` is a vault envelope, never key
-- material — so reading the database yields neither tokens nor the key to forge their hashes.
-- `key_ref` is what `action_tokens.hash_key_ref` records and what a token carries to find its key;
-- one live key per workspace, and a retired key still verifies the tokens it hashed until they
-- lapse (rotation is a new row plus `retired_at` on the old one).
--
-- ---------------------------------------------------------------------------
-- 2. decision_channel_mirrors — one PR comment per decision item, edited, never re-posted.
-- ---------------------------------------------------------------------------
--
--   - **One row per item** (`item_id` is the key): the stored comment ref is what makes a retry or
--     a redeploy edit rather than repost. The SPI's comment marker (decision V9) is the second
--     guard: a publish under the item's key edits whatever comment carries it.
--   - `revision` is bumped by every lifecycle change (filed, refreshed, resolved); `shown_revision`
--     is the last revision the host accepted. Work is pending while they differ, so a change that
--     lands during a publish is never lost — the publish records the revision it read.
--   - A failure is **recorded, never raised**: `last_error` and `attempts` (consecutive failures),
--     reset by the next success. The item exists regardless.
--   - `skip_reason` says honestly why an item has no comment: `no_pr` (no pr ref and no PR opened
--     by its run yet) or `no_comment_surface` (the PR's source cannot comment through the SPI).
--
-- ---------------------------------------------------------------------------
-- 3. notification_preferences — per person per workspace (the settings contract with mockup 17).
-- ---------------------------------------------------------------------------
--
-- A missing row means the defaults: the daily digest **off** (09:00 UTC once enabled), instant
-- mails for `err` items **on**, nothing muted. `instant_severity` is a threshold with two settings,
-- because instant sends exist only for `err` items: `err` or `off`. `muted_kinds` names kinds whose
-- items never mail this person (instant or digest); they stay in the app.
--
-- ---------------------------------------------------------------------------
-- 4. decision_mail_sends — every instant and digest mail, claimed before it leaves.
-- ---------------------------------------------------------------------------
--
-- One row per attempt, claimed by a unique key so two replicas never mail twice: an instant mail
-- per (item, person, attempt), a digest per (person, workspace, slot, attempt). A claim is settled
-- `sent` or `failed` once. The recipient address outlives the person, as #440's send audit does.
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
--   drop table ouroboros.decision_mail_sends;
--   drop table ouroboros.notification_preferences;
--   drop table ouroboros.decision_channel_mirrors;
--   drop table ouroboros.action_token_keys;

-- ---------------------------------------------------------------------------
-- 1. action_token_keys.
-- ---------------------------------------------------------------------------
create table ouroboros.action_token_keys (
  -- V096's hash_key_ref grammar.
  key_ref          text        primary key
                               constraint action_token_keys_key_ref_format
                                 check (key_ref ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- A vault envelope of 32 random bytes. Never the key.
  sealed_key       text        not null
                               constraint action_token_keys_sealed_key_envelope
                                 check (sealed_key like 'ouro.v1.%'),

  created_at       timestamptz not null default now(),
  retired_at       timestamptz,

  constraint action_token_keys_retired_after_created
    check (retired_at is null or retired_at >= created_at)
);

comment on table ouroboros.action_token_keys is
  'The HMAC keys action-token hashes are taken under (#463, BN.3): 32 random bytes per workspace, sealed by the workspace DEK (AD.1) — sealed_key is a vault envelope, never key material. key_ref is what action_tokens.hash_key_ref records and what a token carries. One live key per workspace; a retired key still verifies until its tokens lapse.';
comment on column ouroboros.action_token_keys.sealed_key is
  'The key, sealed by the vault with key_ref as the record id. Unreadable without the workspace DEK.';

create unique index action_token_keys_one_live
  on ouroboros.action_token_keys (organization_id)
  where retired_at is null;

-- ---------------------------------------------------------------------------
-- 2. decision_channel_mirrors.
-- ---------------------------------------------------------------------------
create table ouroboros.decision_channel_mirrors (
  item_id          uuid        primary key,

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- Bumped by every lifecycle change; shown_revision is the last one the host accepted.
  revision         integer     not null default 1
                               constraint decision_channel_mirrors_revision_positive
                                 check (revision >= 1),
  shown_revision   integer,

  -- Where the comment lives, once posted.
  pr_id            uuid        references ouroboros.pull_requests (id) on delete set null,
  comment_id       text,
  comment_url      text,

  -- Why there is no comment, honestly.
  skip_reason      text
                   constraint decision_channel_mirrors_skip_reason
                     check (skip_reason in ('no_pr', 'no_comment_surface')),

  -- The last failure, and how many in a row. Reset by a success.
  last_error       text
                   constraint decision_channel_mirrors_last_error_bounded
                     check (last_error is null or (btrim(last_error) <> '' and length(last_error) <= 500)),
  attempts         integer     not null default 0
                               constraint decision_channel_mirrors_attempts_nonnegative
                                 check (attempts >= 0),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint decision_channel_mirrors_item_fk
    foreign key (item_id, organization_id)
    references ouroboros.decision_items (id, organization_id) on delete cascade,

  constraint decision_channel_mirrors_shown_not_ahead
    check (shown_revision is null or (shown_revision between 1 and revision)),

  -- A shown revision is a comment the host holds.
  constraint decision_channel_mirrors_shown_has_comment
    check (shown_revision is null or comment_id is not null),

  -- A skipped item has no comment.
  constraint decision_channel_mirrors_skipped_has_no_comment
    check (skip_reason is null or comment_id is null)
);

comment on table ouroboros.decision_channel_mirrors is
  'One PR comment per decision item (#463, BN.3, X5): posted on filing, edited on refresh and resolution, never re-posted — the stored comment ref is the idempotency key. revision/shown_revision track pending work; a failure is recorded in last_error/attempts and never blocks the item; skip_reason says why an item has no comment.';
comment on column ouroboros.decision_channel_mirrors.revision is
  'Bumped by every lifecycle change of the item (filed, refreshed, resolved).';
comment on column ouroboros.decision_channel_mirrors.shown_revision is
  'The last revision the host accepted. Pending while it differs from revision.';
comment on column ouroboros.decision_channel_mirrors.skip_reason is
  'no_pr — the item names no PR and its run opened none yet; no_comment_surface — the PR''s source cannot comment through the SPI.';

create index decision_channel_mirrors_pending_idx
  on ouroboros.decision_channel_mirrors (updated_at)
  where shown_revision is distinct from revision;

-- ---------------------------------------------------------------------------
-- 3. notification_preferences.
-- ---------------------------------------------------------------------------
create table ouroboros.notification_preferences (
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,
  user_id          text        not null
                               references ouroboros."user" ("id") on delete cascade,

  digest_enabled   boolean     not null default false,
  -- A UTC wall-clock time, to the minute.
  digest_time      time        not null default '09:00'
                               constraint notification_preferences_digest_time_minute
                                 check (extract(second from digest_time) = 0),
  instant_severity text        not null default 'err'
                               constraint notification_preferences_instant_severity
                                 check (instant_severity in ('err', 'off')),
  muted_kinds      text[]      not null default '{}'
                               constraint notification_preferences_muted_kinds_bounded
                                 check (cardinality(muted_kinds) <= 64
                                        and array_position(muted_kinds, null) is null),

  updated_at       timestamptz not null default now(),

  primary key (organization_id, user_id)
);

comment on table ouroboros.notification_preferences is
  'Per person per workspace decision-mail preferences (#463, BN.3; the settings contract with mockup 17). No row = the defaults: digest off (09:00 UTC once on), instant mails for err items on, nothing muted.';
comment on column ouroboros.notification_preferences.digest_time is
  'When the daily digest leaves, UTC, to the minute.';
comment on column ouroboros.notification_preferences.instant_severity is
  'err — mail each err-severity item as it is filed; off — never. Instant sends exist only for err items.';
comment on column ouroboros.notification_preferences.muted_kinds is
  'Decision kinds that never mail this person, instantly or in the digest. They stay in the app.';

-- ---------------------------------------------------------------------------
-- 4. decision_mail_sends.
-- ---------------------------------------------------------------------------
create table ouroboros.decision_mail_sends (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,
  -- Forgotten when the person is deleted; the address stays as the record of where it went.
  user_id          text        references ouroboros."user" ("id") on delete set null,
  recipient        text        not null
                               constraint decision_mail_sends_recipient_present
                                 check (btrim(recipient) <> '' and length(recipient) <= 320),

  kind             text        not null
                               constraint decision_mail_sends_kind
                                 check (kind in ('instant', 'digest')),
  -- The item an instant mail is about; the slot a digest is for.
  item_id          uuid,
  slot_at          timestamptz,

  attempt          integer     not null
                               constraint decision_mail_sends_attempt_positive
                                 check (attempt >= 1),
  message_id       text        not null,

  status           text        not null default 'claimed'
                               constraint decision_mail_sends_status
                                 check (status in ('claimed', 'sent', 'failed')),
  error            text,

  claimed_at       timestamptz not null default now(),
  settled_at       timestamptz,

  constraint decision_mail_sends_item_fk
    foreign key (item_id, organization_id)
    references ouroboros.decision_items (id, organization_id) on delete cascade,

  -- An instant mail names its item and no slot; a digest its slot and no item.
  constraint decision_mail_sends_subject
    check (case kind
             when 'instant' then item_id is not null and slot_at is null
             when 'digest'  then slot_at is not null and item_id is null
           end),

  -- Claimed: unsettled; sent: settled with no error; failed: settled with why.
  constraint decision_mail_sends_settled_shape
    check (case status
             when 'claimed' then settled_at is null and error is null
             when 'sent'    then settled_at is not null and error is null
             when 'failed'  then settled_at is not null and error is not null and btrim(error) <> ''
           end)
);

comment on table ouroboros.decision_mail_sends is
  'Every decision mail (#463, BN.3): an instant mail per err item and person, a daily digest per person and slot, one row per attempt, claimed before it leaves so replicas never mail twice, settled sent or failed once.';

create unique index decision_mail_sends_instant_key
  on ouroboros.decision_mail_sends (organization_id, user_id, item_id, attempt)
  where kind = 'instant';

create unique index decision_mail_sends_digest_key
  on ouroboros.decision_mail_sends (organization_id, user_id, slot_at, attempt)
  where kind = 'digest';

create index decision_mail_sends_claimed_idx
  on ouroboros.decision_mail_sends (claimed_at)
  where status <> 'sent';

grant select, insert, update on ouroboros.action_token_keys to ouroboros_app;
grant select, insert, update on ouroboros.decision_channel_mirrors to ouroboros_app;
grant select, insert, update on ouroboros.notification_preferences to ouroboros_app;
grant select, insert, update on ouroboros.decision_mail_sends to ouroboros_app;
