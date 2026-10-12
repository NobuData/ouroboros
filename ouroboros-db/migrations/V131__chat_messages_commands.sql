-- V131__chat_messages_commands.sql — every card published and every command invoked (#532, BY.2).
--
-- The moment Ouroboros posts into a channel it owes two things: to be able to **correct** what it
-- said and to **prove** what it said. Mockup 19's six-message stream is six rows across two
-- tables:
--
--   chat_channels ──< chat_messages     an event card, a decision card, a command's reply, a
--                                       system line
--   chat_connections ──< chat_commands  `/ouro status`, from Slack or from the page's console
--
-- **A message row re-renders; it is never markup.** Decision C7 makes the page a truthful mirror
-- of what was published, drawn in the app's own styling. So a row carries what a renderer needs
-- and nothing a platform wrote: `kind`, `card_kind`, typed `refs`, the card's `state`, and
-- `facts` — the figures a template prints (`{"passed": 63, "total": 63}`), as
-- `decision_items.payload` is facts and never prose. No Block Kit is stored.
--
-- **Correction needs the edit key.** A resolved question is an edit of the original card plus a
-- system line. `platform_ts` is what `chat.update` addresses — null until the platform answers
-- the post, then unique per channel — and `chat_messages_platform_ts_key` leads with it, which is
-- also the interactivity lookup that turns a button press back into a row.
--
-- **Refs are #457's, and they resolve.** `refs` is BM.1's `[{type, id, label}]`
-- (`decision_refs_well_formed`), and `chat_messages_refs_resolve` asks `decision_ref_resolves`
-- of each: a card never names a run, pull request or ticket of another workspace, or nothing. The
-- decision item is a real foreign key, `decision_item_id`, whose kind is the row's `card_kind`
-- by the same key — the kind registry is where a decision card's `card_kind` comes from.
--
-- **Retries are certain; duplicates are refused.** `payload_digest` is the publisher's SHA-256
-- of what it is about to post — the rendered content and what it answers — computed before the
-- post. `dedupe_bucket` is `posted_at` binned to the hour, and
-- `chat_messages_dedupe_key` is unique on (channel, digest, bucket): the second attempt creates
-- no row. The bucket is a wall-clock hour, so a retry that crosses the top of the hour is not
-- caught by it — which is why the dangerous case has its own rule:
-- `chat_messages_one_open_decision_card` allows one **open** decision card per (channel, item),
-- whenever it was posted, so one decision never has two answer paths.
--
-- **Commands are privileged and are an audit trail.** `/ouro pause all` is the big red button.
-- A command row records the surface, the command and its parsed arguments, the raw text, and an
-- outcome from the whole matrix — `ok | error | denied | unlinked | async_pending`. An `unlinked`
-- attempt has no identity link and keeps the platform's raw user id. `invoker_link_id` is BY.3's
-- (#533) and carries **no foreign key yet**: the links table does not exist, and #533 adds the
-- constraint when it creates it.
--
-- **Audit linkage.** The services write the audit entry (BZ.3 #537 for a command, BZ.4 #538 for
-- a button press); this migration gives it somewhere to be named and a shape to carry:
--
--   chat_commands.audit_event_id   the command's entry in audit_events (set null if purged)
--   audit_events.detail -> 'chat'  {"connection_id": …, "channel_id": …, "message_id": …}
--
-- `detail` is free jsonb with a GIN containment index (V102), so *everything done from this
-- message* is `detail @> '{"chat": {"message_id": "…"}}'` with no schema change.
--
-- **Retention** — two `custom:*` classes in the retention plane (BQ.3, #482), which
-- `retention_policies` stores without a schema change:
--
--   custom:chat-messages   published cards and lines
--   custom:chat-commands   command records — audit, so never cut earlier than the messages
--
-- `chat_records_sweep()` is the sweep's one write, and the application role holds no `delete` on
-- either table. An open decision card and a command still `async_pending` are never swept:
-- one still takes an answer, the other still owes an outcome.
--
-- To undo (forward only — for a rehearsal against a copy):
--   drop function ouroboros.chat_records_sweep(text, timestamptz, timestamptz, integer);
--   drop table ouroboros.chat_commands;
--   drop table ouroboros.chat_messages;
--   alter table ouroboros.decision_items drop constraint decision_items_id_organization_kind_key;
--   alter table ouroboros.chat_channels
--     drop constraint chat_channels_id_connection_key,
--     drop constraint chat_channels_id_organization_key;
--   alter table ouroboros.chat_connections drop constraint chat_connections_id_organization_key;

-- ---------------------------------------------------------------------------
-- 0. The keys the two tables' workspace-scoped foreign keys point at.
-- ---------------------------------------------------------------------------
alter table ouroboros.chat_connections
  add constraint chat_connections_id_organization_key unique (id, organization_id);

alter table ouroboros.chat_channels
  add constraint chat_channels_id_organization_key unique (id, organization_id),
  add constraint chat_channels_id_connection_key unique (id, connection_id);

-- A decision card's `card_kind` is its item's kind, by key. `kind_id` never changes after an
-- item is filed (decision_items_refuse_repin), so this is the primary key with a fact attached.
alter table ouroboros.decision_items
  add constraint decision_items_id_organization_kind_key unique (id, organization_id, kind_id);

-- ---------------------------------------------------------------------------
-- 1. chat_messages — what was published.
-- ---------------------------------------------------------------------------
create table ouroboros.chat_messages (
  id                  uuid        primary key default gen_random_uuid(),

  -- The channel's workspace, repeated so refs resolve in it and the sweep runs per workspace.
  organization_id     text        not null,
  channel_id          uuid        not null,

  -- The platform's message timestamp (`1723210020.004`) — the `chat.update` key. Null between
  -- the row being written and the platform answering the post.
  platform_ts         text
                                  constraint chat_messages_platform_ts_present
                                    check (platform_ts ~ '^\S{1,64}$'),
  platform_message_id text
                                  constraint chat_messages_platform_message_id_present
                                    check (platform_message_id ~ '^\S{1,128}$'),

  kind                text        not null
                                  constraint chat_messages_kind_known
                                    check (kind in ('decision_card', 'event_card', 'command_reply',
                                                    'system_line')),

  -- Which card: a decision kind's id (BM.1) or an event family. Null for a reply or a bare line.
  card_kind           text
                                  constraint chat_messages_card_kind_grammar
                                    check (card_kind ~ '^(custom:)?[a-z0-9][a-z0-9_-]{0,62}$'),

  -- The decision item a card asks about, or a system line reports on.
  decision_item_id    uuid,

  -- BM.1's typed refs: [{type: run|pr|ticket|path, id, label}], each resolving in this workspace.
  refs                jsonb       not null default '[]'::jsonb
                                  constraint chat_messages_refs_well_formed
                                    check (ouroboros.decision_refs_well_formed(refs)),

  -- The figures a renderer prints. Facts, never markup.
  facts               jsonb       not null default '{}'::jsonb
                                  constraint chat_messages_facts_object
                                    check (jsonb_typeof(facts) = 'object'),

  -- A decision card's current state — what an edit redraws. Null for every other kind.
  state               text
                                  constraint chat_messages_state_known
                                    check (state in ('open', 'resolved')),
  -- The action that answered it (`allow_once`), who pressed it, and when.
  outcome             text
                                  constraint chat_messages_outcome_grammar
                                    check (outcome ~ '^[a-z][a-z0-9_]{0,62}$'),
  resolved_by         text        references ouroboros."user" ("id") on delete set null,
  resolved_at         timestamptz,

  -- SHA-256 of what the publisher is about to post, computed before the post.
  payload_digest      text        not null
                                  constraint chat_messages_payload_digest_sha256
                                    check (payload_digest ~ '^[0-9a-f]{64}$'),

  -- The thread a message belongs to (CB.4, #549): its root's platform_ts. Null at top level.
  thread_ts           text
                                  constraint chat_messages_thread_ts_present
                                    check (thread_ts ~ '^\S{1,64}$'),

  -- When the card was annotated `⚠ escalated`. Null until it is.
  escalated_at        timestamptz,

  posted_at           timestamptz not null default now(),
  edited_at           timestamptz,

  -- The hour the post belongs to — the dedupe window. See the header for what it does not catch.
  dedupe_bucket       timestamptz not null
                                  generated always as
                                    (date_bin(interval '1 hour', posted_at,
                                              timestamptz '2000-01-01 00:00:00+00')) stored,

  constraint chat_messages_channel_fk
    foreign key (channel_id, organization_id)
    references ouroboros.chat_channels (id, organization_id) on delete cascade,

  -- The item is this workspace's and of this card's kind. On the item's delete only the pointer
  -- goes: the row keeps saying which kind of card it was.
  constraint chat_messages_decision_item_fk
    foreign key (decision_item_id, organization_id, card_kind)
    references ouroboros.decision_items (id, organization_id, kind_id)
    on delete set null (decision_item_id),

  constraint chat_messages_card_kind_by_kind
    check (case kind
             when 'decision_card' then card_kind is not null
             when 'event_card'    then card_kind is not null
                                       and card_kind in ('loop_finished', 'build_green',
                                                         'build_failed', 'digest')
             when 'system_line'   then true
             else card_kind is null
           end),

  -- An item belongs to a decision card or to the line that reports on one, and names its kind.
  constraint chat_messages_decision_item_placed
    check (decision_item_id is null
           or (kind in ('decision_card', 'system_line') and card_kind is not null)),

  -- Only a decision card has a state, and it always has one.
  constraint chat_messages_state_is_a_decision_cards
    check ((kind = 'decision_card') = (state is not null)),

  -- Resolved says how and when; open says neither. `resolved_by` may be null — a policy
  -- answered, or the person has since been erased.
  constraint chat_messages_resolution_recorded
    check (case
             when state = 'resolved' then outcome is not null and resolved_at is not null
             else outcome is null and resolved_at is null and resolved_by is null
           end),

  constraint chat_messages_escalation_is_a_decision_cards
    check (escalated_at is null or kind = 'decision_card'),

  constraint chat_messages_edited_after_posted
    check (edited_at is null or edited_at >= posted_at)
);

-- The edit key, and the interactivity lookup: a button press arrives with a ts.
create unique index chat_messages_platform_ts_key
  on ouroboros.chat_messages (platform_ts, channel_id)
  where platform_ts is not null;

-- The mirror's paginated read: a channel's messages, newest first.
create index chat_messages_channel_posted_idx
  on ouroboros.chat_messages (channel_id, posted_at desc, id desc);

-- Dedupe under retry: the same content into the same channel in the same hour is one row.
create unique index chat_messages_dedupe_key
  on ouroboros.chat_messages (channel_id, payload_digest, dedupe_bucket);

-- One decision never has two answer paths in a channel, whenever the second was posted.
create unique index chat_messages_one_open_decision_card
  on ouroboros.chat_messages (channel_id, decision_item_id)
  where kind = 'decision_card' and state = 'open' and decision_item_id is not null;

-- The retention sweep: a workspace's messages, oldest first.
create index chat_messages_organization_posted_idx
  on ouroboros.chat_messages (organization_id, posted_at);

-- The item's delete, and "which cards asked this?".
create index chat_messages_decision_item_idx
  on ouroboros.chat_messages (decision_item_id)
  where decision_item_id is not null;

-- chat_messages_refs_resolve() — BEFORE INSERT OR UPDATE trigger: every run, pr and ticket ref
-- names a row of the message's own workspace.
--   returns the row unchanged; raises class 23 naming the trigger for a dangling ref
create function ouroboros.chat_messages_refs_resolve() returns trigger
language plpgsql
as $$
declare
  dangling jsonb;
begin
  -- A malformed refs value is the CHECK's to refuse, with its own name.
  if not coalesce(ouroboros.decision_refs_well_formed(new.refs), false) then
    return new;
  end if;

  select r into dangling
    from jsonb_array_elements(new.refs) r
   where not ouroboros.decision_ref_resolves(new.organization_id, r)
   limit 1;

  if dangling is not null then
    raise exception 'the % ref % (%) names nothing in workspace %',
      dangling ->> 'type', dangling ->> 'id', dangling ->> 'label', new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.chat_messages_refs_resolve() is
  'BEFORE INSERT OR UPDATE trigger for chat_messages (#532): every run, pr and ticket ref names a row of the message''s own workspace (decision_ref_resolves, #457) — a published card never links to another workspace''s loop or to nothing. Raises class 23 naming the trigger.';

create trigger chat_messages_refs_resolve
  before insert or update of refs, organization_id on ouroboros.chat_messages
  for each row execute function ouroboros.chat_messages_refs_resolve();

comment on table ouroboros.chat_messages is
  'What was published to a chat channel (#532, BY.2): event cards, decision cards, command replies and system lines. A row re-renders from kind, card_kind, refs, state and facts — no platform markup is stored. platform_ts is the edit key; payload_digest with dedupe_bucket makes a retried publish a no-op. Retention class custom:chat-messages (chat_records_sweep).';
comment on column ouroboros.chat_messages.platform_ts is
  'The platform''s message timestamp — what chat.update addresses and what a button press arrives with. Null until the platform has answered the post; unique per channel after.';
comment on column ouroboros.chat_messages.card_kind is
  'A decision card''s decision-kind id (BM.1, #457 — the item''s kind, by foreign key), or an event card''s family: loop_finished | build_green | build_failed | digest. Null for a command reply; a system line carries the kind of the item it reports on, or null.';
comment on column ouroboros.chat_messages.refs is
  'BM.1''s typed canonical refs (#457): [{type: run|pr|ticket|path, id, label}]. Each run, pr and ticket resolves in this workspace (chat_messages_refs_resolve), so the mirror''s tags deep-link. A loop is its run.';
comment on column ouroboros.chat_messages.facts is
  'The figures a renderer prints for this row ({"passed": 63, "total": 63}) — facts, never prose or markup. Always an object.';
comment on column ouroboros.chat_messages.state is
  'A decision card''s current state, open | resolved — what an edit redraws. Null for every other kind. resolved carries outcome (the action id), resolved_at and, when a person answered, resolved_by.';
comment on column ouroboros.chat_messages.payload_digest is
  'SHA-256 (hex) of what the publisher is about to post — the rendered content and what it answers — computed before the post. With dedupe_bucket, the dedupe key.';
comment on column ouroboros.chat_messages.dedupe_bucket is
  'posted_at binned to the UTC hour. A retry inside the same hour collides on chat_messages_dedupe_key; one that crosses the hour does not.';
comment on column ouroboros.chat_messages.thread_ts is
  'The platform_ts of the thread root this message replies under (CB.4, #549). Null for a top-level message.';
comment on column ouroboros.chat_messages.escalated_at is
  'When a decision card was annotated escalated (BZ.4, #538). Null until it is.';
comment on index ouroboros.chat_messages_dedupe_key is
  'Re-publishing identical content to the same channel within the hour creates no row (#532).';
comment on index ouroboros.chat_messages_one_open_decision_card is
  'At most one open decision card per (channel, decision item) (#532): one decision, one answer path, with no window.';

-- No delete: the sweep is the only thing that removes a message.
grant select, insert, update on ouroboros.chat_messages to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 2. chat_commands — what was asked, by whom, and what came of it.
-- ---------------------------------------------------------------------------
create table ouroboros.chat_commands (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null,
  connection_id    uuid        not null,

  -- The channel it was typed in. Null for a console invocation, and for a DM to the app.
  channel_id       uuid,

  -- The invoker's identity link (BY.3, #533). Null for an unlinked attempt and for the console.
  -- **No foreign key yet**: #533 creates chat_identity_links and adds it.
  invoker_link_id  uuid,

  -- The platform's own id for whoever typed it (`U024KEN`) — kept whether or not a link exists.
  platform_user_id text
                               constraint chat_commands_platform_user_id_present
                                 check (platform_user_id ~ '^\S{1,64}$'),

  surface          text        not null
                               constraint chat_commands_surface_known
                                 check (surface in ('slack', 'console')),

  -- The command as dispatched: `status`, `pause all`, `route`. The registry is BZ.3's (#537).
  command          text        not null
                               constraint chat_commands_command_present
                                 check (command ~ '^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$'
                                        and length(command) <= 64),

  -- The arguments as parsed, and the text as typed.
  args             jsonb       not null default '{}'::jsonb
                               constraint chat_commands_args_object
                                 check (jsonb_typeof(args) = 'object'),
  raw_text         text        not null
                               constraint chat_commands_raw_text_bounded
                                 check (raw_text <> '' and length(raw_text) <= 4000),

  outcome          text        not null
                               constraint chat_commands_outcome_known
                                 check (outcome in ('ok', 'error', 'denied', 'unlinked',
                                                    'async_pending')),

  -- What the command produced: {"run": …}, {"message": …}. Null when it produced nothing.
  result_ref       jsonb
                               constraint chat_commands_result_ref_object
                                 check (jsonb_typeof(result_ref) = 'object'),

  error_detail     text
                               constraint chat_commands_error_detail_present
                                 check (btrim(error_detail) = error_detail and error_detail <> ''
                                        and length(error_detail) <= 2000),

  -- The command's entry in the audit plane (#225). Set null if the audit tier purges it.
  audit_event_id   uuid        references ouroboros.audit_events (id) on delete set null,

  invoked_at       timestamptz not null default now(),
  completed_at     timestamptz,

  constraint chat_commands_connection_fk
    foreign key (connection_id, organization_id)
    references ouroboros.chat_connections (id, organization_id) on delete cascade,

  -- The channel is one of the connection's — and so of the same workspace.
  constraint chat_commands_channel_fk
    foreign key (channel_id, connection_id)
    references ouroboros.chat_channels (id, connection_id) on delete cascade,

  -- A Slack invocation is typed by a platform user; the console has no channel and no such user.
  constraint chat_commands_surface_shape
    check (case surface
             when 'slack'   then platform_user_id is not null
             when 'console' then channel_id is null and platform_user_id is null
           end),

  -- Unlinked is exactly "a platform user with no link": recorded, and refused.
  constraint chat_commands_unlinked_has_no_link
    check (outcome <> 'unlinked'
           or (surface = 'slack' and invoker_link_id is null)),

  -- Pending owes an outcome; everything else has finished.
  constraint chat_commands_completion_recorded
    check ((outcome = 'async_pending') = (completed_at is null)),

  constraint chat_commands_completed_after_invoked
    check (completed_at is null or completed_at >= invoked_at),

  -- An error says what went wrong; a success and a pending command have nothing to say yet.
  constraint chat_commands_error_explained
    check (case outcome
             when 'error'         then error_detail is not null
             when 'ok'            then error_detail is null
             when 'async_pending' then error_detail is null
             else true
           end)
);

-- A workspace's command trail, newest first — and the sweep's order, read backwards.
create index chat_commands_organization_invoked_idx
  on ouroboros.chat_commands (organization_id, invoked_at desc, id desc);

-- The mirror interleaves a channel's commands with its messages.
create index chat_commands_channel_invoked_idx
  on ouroboros.chat_commands (channel_id, invoked_at desc, id desc)
  where channel_id is not null;

create index chat_commands_connection_idx on ouroboros.chat_commands (connection_id);

create index chat_commands_invoker_link_idx
  on ouroboros.chat_commands (invoker_link_id)
  where invoker_link_id is not null;

create index chat_commands_audit_event_idx
  on ouroboros.chat_commands (audit_event_id)
  where audit_event_id is not null;

comment on table ouroboros.chat_commands is
  'Every /ouro command invoked (#532, BY.2), from Slack or from the page''s console, in one table told apart by surface. Records the command, its parsed args, the raw text and an outcome — ok | error | denied | unlinked | async_pending. An unlinked attempt keeps the platform''s user id. Retention class custom:chat-commands, never cut earlier than messages (chat_records_sweep).';
comment on column ouroboros.chat_commands.invoker_link_id is
  'The invoker''s chat identity link (BY.3, #533). Null for an unlinked attempt and for a console invocation. Carries no foreign key until #533 creates the links table and adds it.';
comment on column ouroboros.chat_commands.platform_user_id is
  'The platform''s id for whoever typed the command. Always present on the slack surface — including for an unlinked attempt, which is what makes it investigable — and null on the console.';
comment on column ouroboros.chat_commands.surface is
  'slack | console. The console is the page''s composer: no channel and no platform user.';
comment on column ouroboros.chat_commands.outcome is
  'ok | error | denied (the invoker may not do this) | unlinked (no identity link, so no authority) | async_pending (accepted, result to follow — completed_at is null exactly then).';
comment on column ouroboros.chat_commands.result_ref is
  'What the command produced, as an object of ids: the run it started, the message that answered it. Null when it produced nothing.';
comment on column ouroboros.chat_commands.audit_event_id is
  'The command''s audit_events entry (#225), written by the dispatcher (BZ.3, #537) with detail.chat = {connection_id, channel_id, message_id}. Set null if the audit retention tier purges the event.';

-- No delete: the sweep is the only thing that removes a command.
grant select, insert, update on ouroboros.chat_commands to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 3. The retention sweep — the two chat classes' one write.
-- ---------------------------------------------------------------------------

-- chat_records_sweep(organization_id, messages_cutoff, commands_cutoff, limit) — remove a
-- workspace's chat messages and command records past their class's cutoff.
--   p_organization_id — the workspace
--   p_messages_cutoff — RetentionPolicyService's cutoff for custom:chat-messages
--   p_commands_cutoff — its cutoff for custom:chat-commands; a command is cut at the earlier of
--                       the two, so it is never swept before a message of the same age
--   p_limit           — the most rows of each table to remove in one call, oldest first
--   returns (messages, commands) removed
create function ouroboros.chat_records_sweep(p_organization_id text, p_messages_cutoff timestamptz,
                                             p_commands_cutoff timestamptz, p_limit integer)
returns table (messages integer, commands integer)
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
begin
  -- The custom-class floor, beneath the service: no cutoff may reach inside the last seven days.
  if p_messages_cutoff > now() - interval '7 days' or p_commands_cutoff > now() - interval '7 days' then
    raise exception 'a chat record cutoff of % / % is inside the 7-day retention floor',
      p_messages_cutoff, p_commands_cutoff
      using errcode = 'check_violation',
            constraint = 'chat_records_sweep_cutoff_floor',
            hint = 'The cutoffs are RetentionPolicyService''s now() - days for custom:chat-messages and custom:chat-commands, and a custom tier is at least 7 days (#482).';
  end if;

  if p_limit is null or p_limit < 1 then
    raise exception 'a chat record sweep removes at least one row per call, not %', p_limit
      using errcode = 'check_violation', constraint = 'chat_records_sweep_limit';
  end if;

  -- An open decision card still takes an answer, however old it is.
  with doomed as (
    select m.id
      from ouroboros.chat_messages m
     where m.organization_id = p_organization_id
       and m.posted_at < p_messages_cutoff
       and m.state is distinct from 'open'
     order by m.posted_at
     limit p_limit
       for update skip locked
  ), gone as (
    delete from ouroboros.chat_messages m using doomed where m.id = doomed.id returning 1
  )
  select count(*) into messages from gone;

  -- A pending command still owes its outcome.
  with doomed as (
    select c.id
      from ouroboros.chat_commands c
     where c.organization_id = p_organization_id
       and c.invoked_at < least(p_commands_cutoff, p_messages_cutoff)
       and c.outcome <> 'async_pending'
     order by c.invoked_at
     limit p_limit
       for update skip locked
  ), gone as (
    delete from ouroboros.chat_commands c using doomed where c.id = doomed.id returning 1
  )
  select count(*) into commands from gone;

  return next;
end;
$$;

comment on function ouroboros.chat_records_sweep(text, timestamptz, timestamptz, integer) is
  'The chat retention sweep''s one write (#532): removes at most p_limit of the workspace''s messages posted before p_messages_cutoff and at most p_limit of its commands invoked before the earlier of p_commands_cutoff and p_messages_cutoff, oldest first — so command records, which are audit, never go before messages. Never an open decision card or a pending command. Refuses a cutoff inside the 7-day floor. Runs as the owner because the application role cannot delete from either table.';

revoke execute on function ouroboros.chat_records_sweep(text, timestamptz, timestamptz, integer) from public;
grant execute on function ouroboros.chat_records_sweep(text, timestamptz, timestamptz, integer) to ouroboros_app;
