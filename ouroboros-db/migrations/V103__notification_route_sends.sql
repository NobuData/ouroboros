-- V103__notification_route_sends.sql — the send log of the org-level notification routes (#488, BR.4).
--
-- V094 created `notification_routes` (one per workspace and kind, bound to a channel) and the view
-- that derives whether a route can deliver. BR.4 wires the senders: the **daily digest** route
-- mails the workspace's open Needs-You decisions at its `time`, and the **weekly insights** route
-- mails #440's Insights digest at its `weekday`/`time`, each to the route's `recipients` — or,
-- when the route names none, to the workspace's owners and administrators.
--
-- These are **org sends, separate from the per-person ones**: BN.3's `decision_mail_sends` and
-- #440's `insights_digest_sends` key their claims on a person (`user_id`), and a route's recipient
-- is an address that need not belong to anybody. So a route's sends have their own log, keyed on
-- the address:
--
--   - **One row per attempt**, claimed by the unique key (workspace, kind, slot, recipient,
--     attempt) before the mail leaves, so two replicas never mail one address twice for one slot.
--   - A claim is settled `sent` or `failed` once; a claim left `claimed` past the sender's lease
--     (a replica that died mid-send) is failed by the next pass, so the address gets a retry.
--   - `recipient` is the address the mail went to, kept as the record of where it went.
--
-- No foreign key to `notification_routes`: deleting or re-binding a route does not rewrite the
-- record of what it already sent.
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
--   drop table ouroboros.notification_route_sends;

create table ouroboros.notification_route_sends (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The route kinds that send mail in this build.
  kind             text        not null
                               constraint notification_route_sends_kind
                                 check (kind in ('daily_digest', 'weekly_insights')),

  -- The scheduled instant the send is for (UTC).
  slot_at          timestamptz not null,

  recipient        text        not null
                               constraint notification_route_sends_recipient_present
                                 check (btrim(recipient) <> '' and length(recipient) <= 320),

  attempt          integer     not null
                               constraint notification_route_sends_attempt_positive
                                 check (attempt >= 1),
  message_id       text        not null,

  status           text        not null default 'claimed'
                               constraint notification_route_sends_status
                                 check (status in ('claimed', 'sent', 'failed')),
  error            text,

  claimed_at       timestamptz not null default now(),
  settled_at       timestamptz,

  -- Claimed: unsettled; sent: settled with no error; failed: settled with why.
  constraint notification_route_sends_settled_shape
    check (case status
             when 'claimed' then settled_at is null and error is null
             when 'sent'    then settled_at is not null and error is null
             when 'failed'  then settled_at is not null and error is not null and btrim(error) <> ''
           end)
);

comment on table ouroboros.notification_route_sends is
  'Every mail an org-level notification route sent (#488, BR.4): one row per (workspace, kind, slot, recipient, attempt), claimed before it leaves so replicas never mail twice, settled sent or failed once. Separate from the per-person decision_mail_sends and insights_digest_sends, because a route''s recipient is an address, not a member.';
comment on column ouroboros.notification_route_sends.slot_at is
  'The scheduled instant the send is for: the route''s time (daily) or weekday and time (weekly), UTC.';

create unique index notification_route_sends_key
  on ouroboros.notification_route_sends (organization_id, kind, slot_at, recipient, attempt);

create index notification_route_sends_claimed_idx
  on ouroboros.notification_route_sends (claimed_at)
  where status = 'claimed';

grant select, insert, update on ouroboros.notification_route_sends to ouroboros_app;
