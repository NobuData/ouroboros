-- V130__chat_connections_channels.sql — an installed chat workspace, its channels, and the
-- notification routes that target them (#531, BY.1).
--
-- Mockup 19's channel header — `#ouroboros-loops · Slack   24 members · Ouroboros app v2.4` — and
-- the right-hand side of its *What Gets Published Where* rows (`→ #ouroboros-loops + DM on-call`,
-- `→ #helios-alerts`, `→ #eng-leads`) need somewhere durable to live. An installed chat app is a
-- standing grant of authority — it posts as the organisation into rooms its people read — so
-- none of this is a config file:
--
--   chat_connections ──< chat_channels ──< notification_routes.chat_channel_id
--
-- **The bot token is a credential and follows V015/V030/V127, for their reasons.**
-- `bot_token_sealed` is the vault's text envelope (`ouro.v1.<version>.<nonce>.<ciphertext>`, #222)
-- and nothing else — text rather than the ER diagram's `bytea`, as every sealed column in this
-- schema is; the envelope's `<version>` is its DEK reference. Read paths select
-- `chat_connections_public`, which does not mention the column at all, and tests/constraints.sql
-- asserts that no view in the schema depends on it.
--
-- **Revocation is a state, not a delete.** When an admin removes the app from the Slack
-- workspace, publishes start failing with `invalid_auth`; the row then reads `revoked` with the
-- platform's reason in `status_detail`, which is what the page, the Settings tile and the
-- onboarding row explain. `error` is the other not-working state — the platform could not be
-- reached or answered something else — and both are recoverable: a re-install writes `active`
-- again onto the same row (`chat_connections_workspace_key`). The app role holds no `delete`.
-- A connection that is not `active` may drop its token; one that is must have it.
--
-- **One active Slack connection per workspace** (`chat_connections_one_active_slack`). Multi-
-- workspace fan-out is a later migration; until then "the org's Slack connection" is a question
-- with one answer, and the services never guess which workspace an event belongs to.
-- tests/verify-chat-connection-guard.sh proves it under a race.
--
-- **`teams` is storable and inert.** The platform is reserved for CB.2 (#547): a Teams row
-- inserts and reads back, the one-active rule does not count it, and — because a route's
-- `channel` is part of its foreign key to the channel's `platform` — no Slack route can point at
-- a Teams channel.
--
-- **Channels are not strings.** `#helios-alerts` renders as a name and is addressed by an id;
-- names change. A channel row keeps both, so a rename is an update of `channel_name` that no
-- route notices. `joined` is its own fact — the bot cannot post where it is not a member — and is
-- not `archived`: a channel the bot was removed from still exists, an archived one does not take
-- posts from anybody.
--
-- **Routes gain a channel target (the BR.4 amendment).** There is no separate bindings table:
-- V094's `notification_routes` is the binding, one per (workspace, kind), and it gains
-- `chat_channel_id` and `dm_on_call`. Mockup 19's blocking-questions row is two deliveries — a
-- channel post **and** a DM to on-call — and is one row with both set. Three rules:
--
--   * a chat target belongs to a Slack route — an email or PagerDuty route carries neither;
--   * an **enabled** Slack route resolves to at least one delivery target: a channel, the
--     on-call DM, or — for `needs_you_dm`, whose target is the person the item waits on — the
--     kind itself. A disabled route may be stored without one, as BR.4 stores a locked route;
--   * the channel is the route's own workspace's, and on its platform.
--
-- The foreign key is `deferrable initially deferred` and takes no action: a channel a route
-- targets cannot be deleted from under it, and a workspace's delete — which removes routes and
-- channels by different cascade paths — is checked once both are gone (V112's lesson).
--
-- **The Slack lock is not lifted here.** `notification_routes_effective` still answers *connect
-- Slack first* for every Slack route: nothing can deliver to Slack until BZ.2 (#536) publishes,
-- and a route must not read as delivering before something delivers it.
--
-- **Retention.** Connection and channel rows are configuration, not telemetry: they belong to no
-- BQ.3 (#482) retention class and no sweep ages them out. They leave with their workspace.
--
-- To undo (forward only — for a rehearsal against a copy):
--   alter table ouroboros.notification_routes
--     drop constraint notification_routes_slack_target,
--     drop constraint notification_routes_chat_target_slack_only,
--     drop constraint notification_routes_chat_channel_fk,
--     drop column dm_on_call, drop column chat_channel_id;
--   drop view ouroboros.chat_connections_public;
--   drop table ouroboros.chat_channels;
--   drop table ouroboros.chat_connections;

-- ---------------------------------------------------------------------------
-- 1. chat_connections — one installed chat workspace.
-- ---------------------------------------------------------------------------
create table ouroboros.chat_connections (
  id               uuid        primary key default gen_random_uuid(),

  -- Owning workspace. Cascade, as everything a workspace owns.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- `teams` is reserved for CB.2 (#547): storable, and read by nothing.
  platform         text        not null
                               constraint chat_connections_platform_known
                                 check (platform in ('slack', 'teams')),

  -- The platform's own id for the workspace (`T024AB`), and what it is called (`acme-robotics`).
  workspace_id     text        not null
                               constraint chat_connections_workspace_id_present
                                 check (workspace_id ~ '^\S{1,64}$'),
  workspace_name   text        not null
                               constraint chat_connections_workspace_name_present
                                 check (btrim(workspace_name) = workspace_name
                                        and workspace_name <> ''
                                        and length(workspace_name) <= 255),

  -- The bot token, sealed under the workspace DEK. Never the token, and in no view.
  bot_token_sealed text
                               constraint chat_connections_bot_token_sealed
                                 check (bot_token_sealed ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),

  -- The bot's own user on the platform (`U07BOT`) — whose messages are the app's.
  bot_user_id      text
                               constraint chat_connections_bot_user_id_present
                                 check (bot_user_id ~ '^\S{1,64}$'),

  -- {scopes: ["chat:write", …], app_id: "A07…", app_version: "v2.4"} — each key optional.
  install_meta     jsonb       not null default '{}'::jsonb
                               constraint chat_connections_install_meta_object
                                 check (jsonb_typeof(install_meta) = 'object'),

  status           text        not null default 'active'
                               constraint chat_connections_status_known
                                 check (status in ('active', 'revoked', 'error')),

  -- The platform's reason a connection is not working: `invalid_auth`, `account_inactive`, …
  status_detail    text
                               constraint chat_connections_status_detail_present
                                 check (btrim(status_detail) = status_detail
                                        and status_detail <> ''
                                        and length(status_detail) <= 500),

  installed_by     text        references ouroboros."user" ("id") on delete set null,
  installed_at     timestamptz not null default now(),

  -- When the token was last seen to work. Null until the first check.
  last_verified_at timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- A workspace is installed once per platform: a re-install revives this row.
  constraint chat_connections_workspace_key unique (organization_id, platform, workspace_id),

  -- The target of chat_channels' workspace- and platform-scoped foreign key.
  constraint chat_connections_id_organization_platform_key unique (id, organization_id, platform),

  -- Staged on the key's presence and type, so `->` over the wrong shape answers rather than raises.
  constraint chat_connections_install_meta_shape
    check (jsonb_typeof(install_meta) <> 'object'
           or ((not install_meta ? 'scopes' or jsonb_typeof(install_meta -> 'scopes') = 'array')
               and (not install_meta ? 'app_id' or jsonb_typeof(install_meta -> 'app_id') = 'string')
               and (not install_meta ? 'app_version'
                    or jsonb_typeof(install_meta -> 'app_version') = 'string'))),

  -- A working connection has nothing to explain; one that is not says why.
  constraint chat_connections_status_explained
    check ((status = 'active') = (status_detail is null)),

  -- A working connection can post, so it holds its token. A revoked one may let it go.
  constraint chat_connections_active_has_token
    check (status <> 'active' or bot_token_sealed is not null)
);

-- The MVP's single-workspace assumption, as a database fact.
create unique index chat_connections_one_active_slack
  on ouroboros.chat_connections (organization_id)
  where platform = 'slack' and status = 'active';

comment on table ouroboros.chat_connections is
  'An installed chat workspace (#531, BY.1): one row per (workspace, platform, platform workspace). Removing the app is status = revoked with the platform''s reason, never a delete. Read through chat_connections_public, which does not carry the bot token. Configuration, not telemetry: in no retention class (#482).';
comment on column ouroboros.chat_connections.platform is
  'slack | teams. teams is reserved for CB.2 (#547): storable, counted by no rule and read by no Slack path.';
comment on column ouroboros.chat_connections.bot_token_sealed is
  'The bot token, sealed by AD.1''s vault (#222) as an ouro.v1.<version>.<nonce>.<ciphertext> envelope; <version> is its DEK reference. Never the token itself, never in a view, and required while the connection is active.';
comment on column ouroboros.chat_connections.install_meta is
  'What the install granted. Optional keys: scopes (an array), app_id and app_version (strings) — the header''s Ouroboros app v2.4.';
comment on column ouroboros.chat_connections.status is
  'active | revoked | error. revoked: the platform no longer honours the token (the app was removed). error: the platform could not be reached or answered something else. Both are recoverable — a re-install writes active again.';
comment on column ouroboros.chat_connections.status_detail is
  'The platform''s reason a connection is not active (invalid_auth, account_inactive, …). Null exactly when status is active.';
comment on column ouroboros.chat_connections.last_verified_at is
  'When the token was last seen to work. Null until the first check.';
comment on index ouroboros.chat_connections_one_active_slack is
  'At most one active Slack connection per workspace (#531): the MVP is single-workspace, and lifting that is a migration.';

create trigger chat_connections_touch_updated_at
  before update on ouroboros.chat_connections
  for each row execute function ouroboros.touch_updated_at();

-- No delete: revocation is a state, and a workspace's rows leave with the workspace.
grant select, insert, update on ouroboros.chat_connections to ouroboros_app;

-- What a read path selects. The token is not renamed, masked or summarised here — it is absent.
create view ouroboros.chat_connections_public
  with (security_invoker = true) as
select c.id,
       c.organization_id,
       c.platform,
       c.workspace_id,
       c.workspace_name,
       c.bot_user_id,
       c.install_meta,
       c.status,
       c.status_detail,
       c.installed_by,
       c.installed_at,
       c.last_verified_at,
       c.created_at,
       c.updated_at
  from ouroboros.chat_connections c;

comment on view ouroboros.chat_connections_public is
  'chat_connections without the bot token (#531): what every read path selects. The view does not reference bot_token_sealed at all, and tests/constraints.sql asserts no view does.';

grant select on ouroboros.chat_connections_public to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 2. chat_channels — the channels of a connection the product knows about.
-- ---------------------------------------------------------------------------
create table ouroboros.chat_channels (
  id              uuid        primary key default gen_random_uuid(),

  -- The connection's workspace and platform, repeated so that a route's foreign key can require
  -- both; the composite key below keeps them the connection's own.
  organization_id text        not null,
  connection_id   uuid        not null,
  platform        text        not null,

  -- How the platform addresses it (`C071LOOPS`). Stable across a rename.
  channel_id      text        not null
                              constraint chat_channels_channel_id_present
                                check (channel_id ~ '^\S{1,64}$'),

  -- How it reads (`ouroboros-loops`) — without the `#`, which is how it is drawn.
  channel_name    text        not null
                              constraint chat_channels_channel_name_present
                                check (btrim(channel_name) = channel_name
                                       and channel_name <> ''
                                       and channel_name !~ '^#'
                                       and length(channel_name) <= 255),

  is_private      boolean     not null default false,

  -- Whether the bot is a member — it cannot post otherwise. Not the same fact as `archived`.
  joined          boolean     not null default false,
  joined_at       timestamptz,

  -- The header's `24 members`. Null until read from the platform, and refreshed after.
  member_count    integer
                              constraint chat_channels_member_count_nonnegative
                                check (member_count >= 0),

  -- A free tag for what the channel is for: `loops`, `alerts`, `leads`.
  purpose_tag     text
                              constraint chat_channels_purpose_tag_slug
                                check (purpose_tag ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),

  -- The channel was archived on the platform: it takes posts from nobody.
  archived        boolean     not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint chat_channels_connection_fk
    foreign key (connection_id, organization_id, platform)
    references ouroboros.chat_connections (id, organization_id, platform) on delete cascade,

  -- A channel is known once per connection, by its id — never by its name.
  constraint chat_channels_channel_key unique (connection_id, channel_id),

  -- The target of notification_routes' workspace- and platform-scoped foreign key.
  constraint chat_channels_id_organization_platform_key unique (id, organization_id, platform),

  -- A channel the bot is in was joined at some moment. One it has left may remember when.
  constraint chat_channels_joined_at_recorded
    check (not joined or joined_at is not null)
);

comment on table ouroboros.chat_channels is
  'A chat channel of a connection (#531, BY.1): addressed by channel_id, drawn by channel_name, so a rename breaks no route. joined and archived are separate facts. Configuration, not telemetry: in no retention class (#482).';
comment on column ouroboros.chat_channels.channel_name is
  'The channel''s current name, without the leading #. Updated on a rename; nothing is keyed on it.';
comment on column ouroboros.chat_channels.joined is
  'Whether the bot is a member of the channel. false is "the bot was never added, or was removed" — the channel still exists, which archived says it does not.';
comment on column ouroboros.chat_channels.member_count is
  'How many members the platform last reported. Null until first read.';
comment on column ouroboros.chat_channels.purpose_tag is
  'An optional free tag for what the channel is for (loops, alerts, leads): lowercase letters, digits, - and _.';

create trigger chat_channels_touch_updated_at
  before update on ouroboros.chat_channels
  for each row execute function ouroboros.touch_updated_at();

-- No delete: a channel that went away is archived, and routes may still name it.
grant select, insert, update on ouroboros.chat_channels to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 3. notification_routes — the BR.4 amendment: a route may target a chat channel.
-- ---------------------------------------------------------------------------
alter table ouroboros.notification_routes
  add column chat_channel_id uuid,
  add column dm_on_call      boolean not null default false;

comment on column ouroboros.notification_routes.chat_channel_id is
  'The chat channel a Slack route posts to (#531), or null. The channel is this workspace''s and on the route''s platform (notification_routes_chat_channel_fk).';
comment on column ouroboros.notification_routes.dm_on_call is
  'Whether a Slack route also DMs the designated on-call (#531) — mockup 19''s "+ DM on-call". With chat_channel_id, one route is both deliveries.';

-- An enabled Slack route of any kind but needs_you_dm had no target before this migration, and
-- could not deliver either: the lock is still on. BR.4 never stores one enabled; a row written
-- past it is switched off rather than left to fail the rule below.
update ouroboros.notification_routes
   set enabled = false
 where channel = 'slack' and enabled and kind <> 'needs_you_dm';

alter table ouroboros.notification_routes
  -- The route's `channel` is `slack` and the channel's `platform` must be too, so a Slack route
  -- cannot reach a Teams channel. Deferred and without an action: see the header.
  add constraint notification_routes_chat_channel_fk
    foreign key (chat_channel_id, organization_id, channel)
    references ouroboros.chat_channels (id, organization_id, platform)
    deferrable initially deferred,

  add constraint notification_routes_chat_target_slack_only
    check (channel = 'slack' or (chat_channel_id is null and not dm_on_call)),

  add constraint notification_routes_slack_target
    check (channel <> 'slack'
           or not enabled
           or kind = 'needs_you_dm'
           or chat_channel_id is not null
           or dm_on_call);

comment on constraint notification_routes_chat_channel_fk on ouroboros.notification_routes is
  'A route''s chat channel is its own workspace''s and on the route''s platform (#531). Deferred, so a workspace''s delete — which removes routes and channels by different cascades — is checked once both are gone; no action, so a targeted channel cannot be deleted from under its route.';
comment on constraint notification_routes_chat_target_slack_only on ouroboros.notification_routes is
  'Only a Slack route carries a chat target (#531): an email or PagerDuty route has no chat_channel_id and no dm_on_call.';
comment on constraint notification_routes_slack_target on ouroboros.notification_routes is
  'An enabled Slack route resolves to at least one delivery target (#531): a chat channel, the on-call DM, or — for needs_you_dm — the person the item waits on. A disabled route may be stored without one.';

create index notification_routes_chat_channel_idx
  on ouroboros.notification_routes (chat_channel_id)
  where chat_channel_id is not null;
