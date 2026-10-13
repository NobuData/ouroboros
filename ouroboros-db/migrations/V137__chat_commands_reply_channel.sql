-- V137__chat_commands_reply_channel.sql — a command keeps what it said at once, and a console
-- command may be typed under a channel (#542, CA.2).
--
-- The channel mirror shows a channel's stream as Slack shows it: the cards, and between them the
-- commands people typed with what each one answered. Two things the record could not yet say:
--
-- **What a command said at once.** `settled_reply` (V136) is what an *asynchronous* command said
-- when it finished; what any command said the moment it was typed was sent and forgotten — to
-- Slack through the response, to the console in the HTTP answer. `reply` keeps it, on both
-- surfaces, in the shape `settled_reply` has: a text and at most one whole link.
--
--   reply           what it said at once        every command that said something
--   settled_reply   what it said when it ended  an async command, once it settles
--
-- Null is allowed and means nothing is recorded: a row written before this migration, or a
-- command that said nothing. A pending command has a `reply` (its acknowledgement) and no
-- `settled_reply` yet, so `reply` carries no completion rule.
--
-- **Where a console command was typed.** A command typed in the mirror's composer is typed
-- *under a channel*, and shows in that channel's mirror; one typed in the palette is typed
-- nowhere, and shows in none. So the surface rule lets a console row name a `channel_id` — and
-- still no connection, no platform user and no identity link: it is the session's person's, and
-- it is not of the connection the channel belongs to.
--
--   slack    connection ✓ · platform user ✓ · channel or DM            · link when linked
--   console  connection — · platform user — · channel when typed there · link —
--
-- That leaves a hole V131 did not have. `chat_commands_channel_fk` ties a command's channel to
-- its *connection* (`channel_id, connection_id`), and a foreign key with a null column is not
-- checked at all — so a console row, which has no connection, could name another workspace's
-- channel, or one that does not exist. `chat_commands_channel_organization_fk` closes it: the
-- channel is one of the row's own workspace's (`channel_id, organization_id`, against V131's
-- `chat_channels_id_organization_key`), on every surface.
--
-- **A console command outlives the channel it was typed under.** V136's promise is that removing
-- a connection leaves the console's trail. A channel goes with its connection, so before a
-- channel row is deleted its console commands are let go of — `channel_id` set null, the row
-- kept (`chat_channels_release_console_commands`). It is a BEFORE trigger rather than the new
-- key's own `on delete set null`, because two keys to the same channel would then disagree about
-- a Slack row, and which of them acts first is decided by the order of two system trigger names:
-- a Slack command would be deleted on one database and kept channel-less on another. With the
-- release done first, both keys cascade and only Slack rows are left for them to take.
--
-- Rollback (only while no console row names a channel):
--   drop trigger chat_channels_release_console_commands on ouroboros.chat_channels;
--   drop function ouroboros.chat_channels_release_console_commands();
--   alter table ouroboros.chat_commands drop constraint chat_commands_channel_organization_fk;
--   alter table ouroboros.chat_commands drop constraint chat_commands_surface_shape;
--   alter table ouroboros.chat_commands add constraint chat_commands_surface_shape
--     check (case surface
--              when 'slack'   then connection_id is not null and platform_user_id is not null
--              when 'console' then connection_id is null and channel_id is null
--                                  and platform_user_id is null and invoker_link_id is null
--            end);
--   alter table ouroboros.chat_commands drop column reply;
--   (and restore V136's comments on chat_commands_surface_shape and chat_commands.surface)

-- ---------------------------------------------------------------------------
-- 1. What a command said at once.
-- ---------------------------------------------------------------------------
-- The rule is `settled_reply`'s (V136). A key that is absent has no type — `jsonb_typeof` answers
-- null, and a CHECK admits null — so each required key's test is coalesced to false: `{}` and a
-- link with no url are refused.
alter table ouroboros.chat_commands
  add column reply jsonb
    constraint chat_commands_reply_shape
      check (reply is null
             or (jsonb_typeof(reply) = 'object'
                 and coalesce(jsonb_typeof(reply -> 'text') = 'string', false)
                 and reply ->> 'text' <> ''
                 and (not reply ? 'link'
                      or (jsonb_typeof(reply -> 'link') = 'object'
                          and coalesce(jsonb_typeof(reply #> '{link,label}') = 'string', false)
                          and coalesce(jsonb_typeof(reply #> '{link,url}') = 'string', false)))));

comment on column ouroboros.chat_commands.reply is
  'What the command said at once (#542): {"text": …, "link": {"label": …, "url": …}}, the link optional. Written by the dispatcher on both surfaces, whatever the outcome — a refusal''s words too. Null for a row from before V137 and for a command that said nothing. What an asynchronous command said when it finished is settled_reply.';
comment on column ouroboros.chat_commands.settled_reply is
  'What an asynchronous command said when it finished (#539): {"text": …, "link": {"label": …, "url": …}}, the link optional. Written when an async_pending row settles, so the console — which has no response_url to be told through — can read the result later. Null for a command that answered at once; what it said then is reply (#542).';

-- ---------------------------------------------------------------------------
-- 2. A console command may be typed under a channel.
-- ---------------------------------------------------------------------------
alter table ouroboros.chat_commands
  drop constraint chat_commands_surface_shape;

alter table ouroboros.chat_commands
  add constraint chat_commands_surface_shape
    check (case surface
             when 'slack'   then connection_id is not null
                                 and platform_user_id is not null
             when 'console' then connection_id is null
                                 and platform_user_id is null
                                 and invoker_link_id is null
           end);

comment on constraint chat_commands_surface_shape on ouroboros.chat_commands is
  'What each surface records (#532, #539, #542): a Slack command has its connection and the platform user who typed it; a console command has neither, nor an identity link — its invoker is the session''s person, in invoker_user_id. Either may name a channel: a console command does when it was typed in that channel''s mirror.';
comment on column ouroboros.chat_commands.surface is
  'slack | console. The console is the app''s own composer: no connection and no platform user, and a channel only when the command was typed in that channel''s mirror (#542).';
comment on column ouroboros.chat_commands.channel_id is
  'The channel the command was typed in — in Slack, or (#542) under in the app''s channel mirror. Null for a DM to the app and for a console command typed in the palette. Always a channel of the row''s own workspace (chat_commands_channel_organization_fk); a Slack command''s is also one of its connection''s (chat_commands_channel_fk).';

-- ---------------------------------------------------------------------------
-- 3. The channel is the row's own workspace's — with or without a connection.
-- ---------------------------------------------------------------------------
-- `chat_commands_channel_fk` (channel, connection) says nothing about a row whose connection is
-- null. This key does not depend on one. Every existing row already satisfies it: until now a
-- channel was only ever named beside a connection, and the connection and the channel each
-- carry their workspace by key (`chat_commands_connection_fk`, `chat_channels_connection_fk`).
alter table ouroboros.chat_commands
  add constraint chat_commands_channel_organization_fk
    foreign key (channel_id, organization_id)
    references ouroboros.chat_channels (id, organization_id) on delete cascade;

comment on constraint chat_commands_channel_organization_fk on ouroboros.chat_commands is
  'A command''s channel is one of its own workspace''s (#542). What chat_commands_channel_fk cannot say for a console command, which has no connection to reach the channel through. Cascades, as that key does — and takes only Slack rows, because a channel''s console commands are released before it is deleted (chat_channels_release_console_commands).';

-- ---------------------------------------------------------------------------
-- 4. A console command outlives the channel it was typed under.
-- ---------------------------------------------------------------------------
create function ouroboros.chat_channels_release_console_commands()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  update ouroboros.chat_commands c
     set channel_id = null
   where c.channel_id = old.id
     and c.surface = 'console';

  return old;
end;
$$;

comment on function ouroboros.chat_channels_release_console_commands() is
  'Before a chat channel is deleted, its console commands let go of it (#542): channel_id set null, the row kept — the console''s trail outlives a connection and so its channels (V136). Slack commands are left for the channel''s cascade.';

create trigger chat_channels_release_console_commands
  before delete on ouroboros.chat_channels
  for each row execute function ouroboros.chat_channels_release_console_commands();
