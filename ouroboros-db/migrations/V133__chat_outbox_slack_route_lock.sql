-- V133__chat_outbox_slack_route_lock.sql — what is about to be said in a channel, and when a
-- Slack route may deliver (#536, BZ.2).
--
-- `chat_messages` (V131) records what *was* published. Nothing recorded what was *meant* to be:
-- a post interrupted by a redeploy, refused by a rate limit or lost to a network failure left no
-- trace, so it could not be retried and nobody could be told it never arrived. Two changes:
--
--   plane event ──▶ route evaluation ──▶ chat_outbox ──▶ post / update ──▶ chat_messages
--
-- **The outbox is the intent, durable before anything is sent.** One row per (target, thing to
-- say): a channel or a person to DM, whether it is a new post or an edit of a stored message,
-- what kind of card, and the subject it is rendered from. The row is written in the transaction
-- of the event that caused it, the way `webhook_outbox` rows are (BR.3, #487).
--
-- **The same thing is intended once.** `dedupe_key` is the SHA-256 of what the row is about —
-- the card's family and its subject, never its rendered text — and it is unique per target. A
-- plane that reports the same event twice, or a sweep that finds the same due digest twice,
-- inserts one row.
--
-- **Retries are state, not hope.** `pending` rows carry `next_attempt_at`; the dispatcher claims
-- due ones `for update skip locked`, leases them by pushing that instant forward, and settles
-- each as `sent`, `absorbed` (the message already existed — `chat_messages_dedupe_key` refused a
-- second one), `skipped` (there was nowhere left to say it: the connection was revoked, the
-- channel archived, the card it would edit never posted) or `dead_lettered` (the attempts ran
-- out). A dead letter is a row, with its last error, which is what a health banner reads.
--
-- **The Slack lock follows the connection.** `notification_routes_effective` answered *connect
-- Slack first* for every Slack route, because nothing could deliver to Slack. Something can now,
-- so the lock is derived from the fact it names: a Slack route is locked exactly when its
-- workspace has no active Slack connection. PagerDuty stays locked (BT.3).
--
-- Rollback:
--   create or replace view ouroboros.notification_routes_effective … as V094 defined it;
--   drop table ouroboros.chat_outbox;

-- ---------------------------------------------------------------------------
-- 1. chat_outbox — what is about to be published
-- ---------------------------------------------------------------------------
create table ouroboros.chat_outbox (
  id                  uuid        primary key default gen_random_uuid(),

  -- The workspace and the connection the row publishes through. Scoped together by key.
  organization_id     text        not null,
  connection_id       uuid        not null,

  -- Where it goes: a channel the connection knows, or a person on the platform (a DM, whose
  -- conversation is opened when the row is dispatched). Exactly one.
  channel_id          uuid,
  dm_platform_user_id text
                                  constraint chat_outbox_dm_platform_user_id_present
                                    check (dm_platform_user_id ~ '^\S{1,64}$'),

  -- A new message, or an edit of a stored one.
  operation           text        not null default 'post'
                                  constraint chat_outbox_operation_known
                                    check (operation in ('post', 'update')),

  -- What is said, in chat_messages' own vocabulary. A command reply answers its invoker
  -- directly and never passes through here.
  message_kind        text        not null
                                  constraint chat_outbox_message_kind_known
                                    check (message_kind in ('decision_card', 'event_card', 'system_line')),
  card_kind           text        not null
                                  constraint chat_outbox_card_kind_slug
                                    check (card_kind ~ '^(custom:)?[a-z0-9][a-z0-9_-]{0,62}$'),

  -- The decision a card or a system line is about.
  decision_item_id    uuid,

  -- What the renderer reads to compose the message ({"run_id": …}, {"slot": …}) — references and
  -- instants, never prose: the text is composed when the row is dispatched, from current facts.
  subject             jsonb       not null default '{}'::jsonb
                                  constraint chat_outbox_subject_is_object
                                    check (jsonb_typeof(subject) = 'object'),

  -- The notification route that sent it here — why this channel got this message.
  route_kind          text        not null
                                  constraint chat_outbox_route_kind_slug
                                    check (route_kind ~ '^(custom:)?[a-z0-9][a-z0-9_-]{0,62}$'),

  -- SHA-256 (hex) of what the row is about. Unique per target, below.
  dedupe_key          text        not null
                                  constraint chat_outbox_dedupe_key_sha256
                                    check (dedupe_key ~ '^[0-9a-f]{64}$'),

  status              text        not null default 'pending'
                                  constraint chat_outbox_status_known
                                    check (status in ('pending', 'sent', 'absorbed', 'skipped',
                                                      'dead_lettered')),

  -- How many times it has been tried, when it is next due, and what went wrong last.
  attempts            integer     not null default 0
                                  constraint chat_outbox_attempts_nonnegative
                                    check (attempts >= 0),
  next_attempt_at     timestamptz default now(),
  last_error          text
                                  constraint chat_outbox_last_error_present
                                    check (btrim(last_error) = last_error
                                           and last_error <> ''
                                           and length(last_error) <= 500),

  -- The message: the one an update edits (known when the row is written), or the one a post
  -- created (known once it is sent).
  message_id          uuid        references ouroboros.chat_messages (id) on delete cascade,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  settled_at          timestamptz,

  constraint chat_outbox_connection_fk
    foreign key (connection_id, organization_id)
    references ouroboros.chat_connections (id, organization_id) on delete cascade,

  -- The channel is this connection's own.
  constraint chat_outbox_channel_fk
    foreign key (channel_id, connection_id)
    references ouroboros.chat_channels (id, connection_id) on delete cascade,

  -- The item is this workspace's and of this card's kind. An intent about a deleted decision is
  -- void, so it goes with the item.
  constraint chat_outbox_decision_item_fk
    foreign key (decision_item_id, organization_id, card_kind)
    references ouroboros.decision_items (id, organization_id, kind_id) on delete cascade,

  constraint chat_outbox_one_target
    check (num_nonnulls(channel_id, dm_platform_user_id) = 1),

  -- An event card is one of the four families chat_messages admits; a decision card or a system
  -- line about a decision names it.
  constraint chat_outbox_card_kind_by_kind
    check (message_kind <> 'event_card'
           or card_kind in ('loop_finished', 'build_green', 'build_failed', 'digest')),
  constraint chat_outbox_decision_card_names_item
    check (message_kind <> 'decision_card' or decision_item_id is not null),
  constraint chat_outbox_decision_item_placed
    check (decision_item_id is null or message_kind in ('decision_card', 'system_line')),

  -- Only a decision card is ever edited, and an edit knows what it edits from the start.
  constraint chat_outbox_update_is_a_decision_cards
    check (operation <> 'update' or (message_kind = 'decision_card' and message_id is not null)),

  -- Pending is exactly "has a next attempt"; settled is exactly "has a settled instant".
  constraint chat_outbox_pending_is_due
    check ((status = 'pending') = (next_attempt_at is not null)),
  constraint chat_outbox_settled_is_stamped
    check ((status = 'pending') = (settled_at is null)),

  -- A dead letter says why.
  constraint chat_outbox_dead_letter_explained
    check (status <> 'dead_lettered' or last_error is not null)
);

comment on table ouroboros.chat_outbox is
  'What is about to be published to a chat channel or DM (#536, BZ.2): the durable intent behind every chat_messages row, written in the transaction of the event that caused it. pending rows are claimed for update skip locked and settled as sent, absorbed (the message already existed), skipped (nowhere left to say it) or dead_lettered (the attempts ran out).';
comment on column ouroboros.chat_outbox.dm_platform_user_id is
  'The platform user a DM goes to (U07KEN). The conversation is opened, and its chat_channels row written, when the row is dispatched.';
comment on column ouroboros.chat_outbox.subject is
  'What the renderer reads to compose the message — ids and instants, never prose. The text is composed at dispatch from current facts. Always an object.';
comment on column ouroboros.chat_outbox.route_kind is
  'The notification route (BR.4, #488) whose binding sent this message to this target.';
comment on column ouroboros.chat_outbox.dedupe_key is
  'SHA-256 (hex) of what the row is about — the card''s family and its subject, never the rendered text. Unique per target: the same thing is intended once.';
comment on column ouroboros.chat_outbox.status is
  'pending | sent | absorbed | skipped | dead_lettered. absorbed: chat_messages_dedupe_key already held the message. skipped: the connection was revoked, the channel archived or left, or the card to edit was never posted. dead_lettered: attempts ran out; last_error says why.';
comment on column ouroboros.chat_outbox.next_attempt_at is
  'When a pending row is next due. A dispatcher that claims the row pushes this forward as its lease, so a crashed attempt becomes due again. Null exactly when the row is settled.';
comment on column ouroboros.chat_outbox.message_id is
  'The chat_messages row: the one an update edits, or the one a post created.';

-- The same thing is said once per target.
create unique index chat_outbox_channel_dedupe_key
  on ouroboros.chat_outbox (channel_id, dedupe_key)
  where channel_id is not null;
create unique index chat_outbox_dm_dedupe_key
  on ouroboros.chat_outbox (connection_id, dm_platform_user_id, dedupe_key)
  where dm_platform_user_id is not null;

comment on index ouroboros.chat_outbox_channel_dedupe_key is
  'Enqueueing the same intent for the same channel twice creates no second row (#536).';

-- The dispatcher's claim: what is due, oldest first.
create index chat_outbox_due_idx
  on ouroboros.chat_outbox (next_attempt_at, id)
  where status = 'pending';

-- The health read: a connection's dead letters and its backlog.
create index chat_outbox_connection_status_idx
  on ouroboros.chat_outbox (connection_id, status, updated_at desc);

-- The lifecycle hook's read: what was intended for a decision.
create index chat_outbox_decision_item_idx
  on ouroboros.chat_outbox (decision_item_id)
  where decision_item_id is not null;

create trigger chat_outbox_touch_updated_at
  before update on ouroboros.chat_outbox
  for each row execute function ouroboros.touch_updated_at();

-- Delete included: a settled row has done its work, and the dispatcher prunes old ones.
grant select, insert, update, delete on ouroboros.chat_outbox to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 2. The Slack route lock follows the connection
-- ---------------------------------------------------------------------------
-- Same columns, same order: `create or replace` keeps every grant and dependant.
create or replace view ouroboros.notification_routes_effective
  with (security_invoker = true) as
select r.organization_id,
       r.kind,
       r.channel,
       r.config,
       r.enabled,
       lock.reason                          as locked_reason,
       (lock.reason is not null)            as locked,
       (r.enabled and lock.reason is null)  as delivering,
       r.updated_by,
       r.updated_at
  from ouroboros.notification_routes r
  cross join lateral (
    select case r.channel
             when 'email'     then null
             when 'slack'     then case when exists (
                                          select 1
                                            from ouroboros.chat_connections c
                                           where c.organization_id = r.organization_id
                                             and c.platform = 'slack'
                                             and c.status = 'active')
                                        then null
                                        else 'connect Slack first'
                                   end
             when 'pagerduty' then 'connect PagerDuty first'
           end as reason
  ) lock;

comment on view ouroboros.notification_routes_effective is
  'notification_routes with the lock derived (#484): a route whose channel cannot deliver is locked with the reason the card prints, and delivering is enabled ∧ ¬locked. Email always delivers; a Slack route is locked exactly while its workspace has no active Slack connection (#536); PagerDuty stays locked until BT.3.';
