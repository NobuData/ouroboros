-- V136__chat_commands_console.sql — a command typed in the app's own console is recorded like
-- one typed in Slack (#539, BZ.5).
--
-- `chat_commands` (V131) already names two surfaces, `slack` and `console`, but only the first
-- could be written: every row needed a chat connection, and nothing said who typed a console
-- command — in Slack that is the identity link, and the console has none because the invoker is
-- the signed-in session. Two changes make the second surface real:
--
--   slack    connection ✓ · platform user ✓ · link when linked · invoker = the link's person
--   console  connection — · platform user — · link —            · invoker = the session's person
--
-- **A console command needs no connection.** `connection_id` becomes nullable, and the surface
-- rule says which surface may leave it out: a Slack command always has one; a console command
-- never does — a workspace that has not installed the Slack app still gets the grammar, and a
-- console command typed in a workspace that has is still not *of* that connection, so removing
-- the connection does not take the console's trail with it.
-- With no connection to reach its workspace through, the row's own `organization_id` becomes a
-- key to the workspace (`chat_commands_organization_fk`), so a console command cannot name a
-- workspace that does not exist and goes when its workspace does.
--
-- **Who it acted as is a column.** `invoker_user_id` is the person the command ran as, on both
-- surfaces: the session's person in the console, the linked person in Slack (null for an
-- unlinked attempt). Existing Slack rows are back-filled from their link. It is `set null` when
-- the person is deleted — the row is an audit trail and outlives them, as `audit_events` does.
--
-- **A late result is kept.** An asynchronous command (`dry-run`) answers at once and finishes
-- later. Slack is told through its `response_url`; the console has no such address — it asks
-- for the command again — so what the command finally said is stored: `settled_reply`, the text
-- and its one link, written when an `async_pending` row settles.
--
-- Rollback (only while no console row exists):
--   alter table ouroboros.chat_commands drop column settled_reply;
--   alter table ouroboros.chat_commands drop constraint chat_commands_organization_fk;
--   alter table ouroboros.chat_commands drop constraint chat_commands_surface_shape;
--   alter table ouroboros.chat_commands add constraint chat_commands_surface_shape
--     check (case surface when 'slack' then platform_user_id is not null
--                         when 'console' then channel_id is null and platform_user_id is null end);
--   drop index ouroboros.chat_commands_invoker_user_idx;
--   alter table ouroboros.chat_commands drop column invoker_user_id;
--   alter table ouroboros.chat_commands alter column connection_id set not null;

-- ---------------------------------------------------------------------------
-- 1. Who the command acted as.
-- ---------------------------------------------------------------------------
alter table ouroboros.chat_commands
  add column invoker_user_id text
    constraint chat_commands_invoker_user_fk
      references ouroboros."user" ("id") on delete set null;

alter table ouroboros.chat_commands disable trigger user;

update ouroboros.chat_commands c
   set invoker_user_id = l.user_id
  from ouroboros.chat_identity_links l
 where l.id = c.invoker_link_id
   and l.user_id is not null;

alter table ouroboros.chat_commands enable trigger user;

comment on column ouroboros.chat_commands.invoker_user_id is
  'The person the command acted as (#539): the signed-in session''s person for a console command, the linked person for a Slack one. Null for an unlinked Slack attempt, and once the person is deleted — the row is a trail and outlives them.';

-- A person's own recent commands in a workspace, newest first.
create index chat_commands_invoker_user_idx
  on ouroboros.chat_commands (organization_id, invoker_user_id, invoked_at desc)
  where invoker_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. A console command has no connection; a Slack command always has one.
-- ---------------------------------------------------------------------------
alter table ouroboros.chat_commands
  alter column connection_id drop not null;

alter table ouroboros.chat_commands
  drop constraint chat_commands_surface_shape;

alter table ouroboros.chat_commands
  add constraint chat_commands_surface_shape
    check (case surface
             when 'slack'   then connection_id is not null
                                 and platform_user_id is not null
             when 'console' then connection_id is null
                                 and channel_id is null
                                 and platform_user_id is null
                                 and invoker_link_id is null
           end);

-- Until now a command reached its workspace only through its connection's key. A console command
-- has no connection, so the workspace is named directly: it must exist, and it takes its console
-- commands with it as the connection's cascade takes the Slack ones.
alter table ouroboros.chat_commands
  add constraint chat_commands_organization_fk
    foreign key (organization_id)
    references ouroboros.organization ("id") on delete cascade;

comment on constraint chat_commands_surface_shape on ouroboros.chat_commands is
  'What each surface records (#532, #539): a Slack command has its connection and the platform user who typed it; a console command has neither, nor a channel or an identity link — its invoker is the session''s person, in invoker_user_id.';
comment on column ouroboros.chat_commands.connection_id is
  'The chat connection a Slack command arrived through. Null for a console command (#539), which is typed in the app and belongs to no connection.';

-- ---------------------------------------------------------------------------
-- 3. What an asynchronous command finally said.
-- ---------------------------------------------------------------------------
-- A key that is absent has no type — `jsonb_typeof` answers null, and a CHECK admits null — so
-- each required key's test is coalesced to false: `{}` and a link with no url are refused.
alter table ouroboros.chat_commands
  add column settled_reply jsonb
    constraint chat_commands_settled_reply_shape
      check (settled_reply is null
             or (jsonb_typeof(settled_reply) = 'object'
                 and coalesce(jsonb_typeof(settled_reply -> 'text') = 'string', false)
                 and settled_reply ->> 'text' <> ''
                 and (not settled_reply ? 'link'
                      or (jsonb_typeof(settled_reply -> 'link') = 'object'
                          and coalesce(jsonb_typeof(settled_reply #> '{link,label}') = 'string', false)
                          and coalesce(jsonb_typeof(settled_reply #> '{link,url}') = 'string', false))))),

  -- Only a command that has finished has a final word.
  add constraint chat_commands_settled_reply_when_complete
    check (settled_reply is null or completed_at is not null);

comment on column ouroboros.chat_commands.settled_reply is
  'What an asynchronous command said when it finished (#539): {"text": …, "link": {"label": …, "url": …}}, the link optional. Written when an async_pending row settles, so the console — which has no response_url to be told through — can read the result later. Null for a command that answered at once.';
