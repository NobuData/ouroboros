-- V135__decision_escalation_timers.sql — the timer behind `escalates to the Needs-you inbox in
-- 26m`, and what escalating does to an item (#538, BZ.4).
--
-- A decision card in a channel says how long the question has waited and when it stops depending
-- on someone reading that channel. Until now that line was a caption: it was computed from the
-- kind's `escalation_window` (V093) when the card was posted, and nothing ever happened at the
-- end of it. Three things make it a fact:
--
--   card intended ──▶ decision_escalation_timers (due_at) ──▶ fired: item escalated_at,
--                          │                                   card escalated_at, DM on-call
--                          └─ item answered · snoozed · withdrawn ──▶ cancelled, never fires
--
-- **The timer is a row.** One per decision item, started when the item's card is first intended
-- for a channel, due at the item's filing instant plus its window — the same two numbers the
-- card's footnote prints, so the line cannot drift from the mechanism. It ends exactly one way:
-- `fired_at` or `cancelled_at` (with why), and a settled timer never changes again. A process
-- that was down when a timer came due finds it still pending and fires it once.
--
-- **The window is the kind's, unless the workspace says otherwise.**
-- `decision_escalation_overrides` holds a workspace's own window for a kind (V093 left this
-- here); `decision_escalation_window` answers the override, else the item's pinned kind's. A
-- timer copies the window it started with, so a later override moves no running timer.
--
-- **Cancelling is the database's.** A trigger on `decision_items` cancels the pending timer the
-- moment the item leaves `open` — answered, snoozed or expired — in the transaction that moved
-- it. No listener has to hear about it for *a cancelled timer never fires* to hold.
--
-- **Escalating raises the item.** `decision_items.escalated_at` is stamped once and never moved;
-- the Needs-you queue lists escalated items first. Severity is left as the kind declared it.
-- `chat_messages.escalated_at` (V131) is stamped on the item's open cards in the same statement
-- group, which is what the card's annotation renders from.
--
-- Rollback:
--   drop function ouroboros.decision_escalation_fire(uuid, timestamptz);
--   drop function ouroboros.decision_escalation_timer_start(uuid);
--   drop function ouroboros.decision_escalation_window(text, text, integer);
--   drop trigger decision_items_cancel_escalation on ouroboros.decision_items;
--   drop function ouroboros.decision_items_cancel_escalation();
--   drop trigger decision_items_escalated_at_fixed on ouroboros.decision_items;
--   drop function ouroboros.decision_items_escalated_at_fixed();
--   drop table ouroboros.decision_escalation_timers;
--   drop table ouroboros.decision_escalation_overrides;
--   alter table ouroboros.decision_items drop column escalated_at;

-- ---------------------------------------------------------------------------
-- 1. decision_items.escalated_at — stamped once
-- ---------------------------------------------------------------------------
alter table ouroboros.decision_items
  add column escalated_at timestamptz;

comment on column ouroboros.decision_items.escalated_at is
  'When the item''s escalation timer fired (#538): nobody answered within the window. Stamped once by decision_escalation_fire and never moved or cleared; the Needs-you queue lists escalated items first. Null for an item that never escalated.';

create function ouroboros.decision_items_escalated_at_fixed() returns trigger
language plpgsql
as $$
begin
  if old.escalated_at is not null and new.escalated_at is distinct from old.escalated_at then
    raise exception
      'decision item % escalated at % and that stays: an escalation is never moved or undone',
      old.id, old.escalated_at
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'See V135__decision_escalation_timers.sql (#538).';
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_items_escalated_at_fixed() is
  'BEFORE UPDATE trigger for decision_items (#538): escalated_at is stamped once, so an item that escalated cannot be made to look as if it had not.';

create trigger decision_items_escalated_at_fixed
  before update on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_escalated_at_fixed();

-- ---------------------------------------------------------------------------
-- 2. decision_escalation_overrides — a workspace's own window for a kind
-- ---------------------------------------------------------------------------
create table ouroboros.decision_escalation_overrides (
  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,
  kind_id           text        not null,

  -- Held to the bounds a kind's own window is (V093).
  escalation_window interval    not null
                                constraint decision_escalation_overrides_window_positive
                                  check (escalation_window > interval '0'
                                         and escalation_window <= interval '7 days'),

  -- Who set it; kept when they leave.
  updated_by        text        references ouroboros."user" ("id") on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint decision_escalation_overrides_pkey primary key (organization_id, kind_id)
);

comment on table ouroboros.decision_escalation_overrides is
  'A workspace''s own escalation window for a decision kind (#538): how long an unanswered item of that kind waits before its timer fires, instead of decision_kinds.escalation_window. One row per (workspace, kind); read by decision_escalation_window when a timer starts, so it moves no timer already running.';
comment on column ouroboros.decision_escalation_overrides.kind_id is
  'The decision kind, by id — every version of it. A trigger refuses an id no declared kind has.';

create index decision_escalation_overrides_updated_by_idx
  on ouroboros.decision_escalation_overrides (updated_by)
  where updated_by is not null;

create function ouroboros.decision_escalation_overrides_kind_known() returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from ouroboros.decision_kinds k where k.kind_id = new.kind_id) then
    raise exception
      'no decision kind is declared as %: an escalation window is set for a kind that exists',
      new.kind_id
      using errcode = 'foreign_key_violation', constraint = tg_name,
            hint = 'See V135__decision_escalation_timers.sql (#538).';
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_escalation_overrides_kind_known() is
  'BEFORE INSERT OR UPDATE trigger for decision_escalation_overrides (#538): kind_id names a declared kind. decision_kinds is keyed by (kind_id, version), so a foreign key cannot say it.';

create trigger decision_escalation_overrides_kind_known
  before insert or update of kind_id on ouroboros.decision_escalation_overrides
  for each row execute function ouroboros.decision_escalation_overrides_kind_known();

create trigger decision_escalation_overrides_touch_updated_at
  before update on ouroboros.decision_escalation_overrides
  for each row execute function ouroboros.touch_updated_at();

grant select, insert, update, delete on ouroboros.decision_escalation_overrides to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 3. decision_escalation_timers — one per item, ending exactly one way
-- ---------------------------------------------------------------------------
create table ouroboros.decision_escalation_timers (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   text        not null,
  decision_item_id  uuid        not null,
  kind_id           text        not null,

  -- The window it started with, and the two instants it implies. `started_at` is the item's
  -- filing instant: the card counts from when the question was asked, not from when it posted.
  escalation_window interval    not null
                                constraint decision_escalation_timers_window_positive
                                  check (escalation_window > interval '0'),
  started_at        timestamptz not null,
  due_at            timestamptz not null,

  fired_at          timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text
                                constraint decision_escalation_timers_cancel_reason_known
                                  check (cancel_reason in ('resolved', 'snoozed', 'withdrawn')),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One timer per item: a second card for the same decision shares it.
  constraint decision_escalation_timers_decision_item_key unique (decision_item_id),

  -- The item is this workspace's and of this kind. A timer for a deleted decision is void.
  constraint decision_escalation_timers_decision_item_fk
    foreign key (decision_item_id, organization_id, kind_id)
    references ouroboros.decision_items (id, organization_id, kind_id) on delete cascade,

  constraint decision_escalation_timers_due_after_start
    check (due_at > started_at),

  -- It ends one way, and a cancellation says why.
  constraint decision_escalation_timers_one_ending
    check (num_nonnulls(fired_at, cancelled_at) <= 1),
  constraint decision_escalation_timers_cancel_explained
    check ((cancelled_at is null) = (cancel_reason is null))
);

comment on table ouroboros.decision_escalation_timers is
  'The escalation timer of a decision item (#538): started when the item''s card is first intended for a chat channel, due at the item''s filing instant plus its window, and ended exactly once — fired (decision_escalation_fire) or cancelled when the item is answered, snoozed or withdrawn. Pending rows are claimed for update skip locked; a row survives a restart, so a timer missed during downtime fires once on recovery.';
comment on column ouroboros.decision_escalation_timers.escalation_window is
  'The window the timer started with — the workspace''s override or the pinned kind''s. Copied, so a later override moves no running timer.';
comment on column ouroboros.decision_escalation_timers.due_at is
  'started_at + escalation_window: when the item escalates if nobody has answered. What the card''s countdown is computed from.';
comment on column ouroboros.decision_escalation_timers.cancel_reason is
  'Why a cancelled timer will never fire: the item was resolved, snoozed, or withdrawn (expired).';

-- The pass's claim: what is due, oldest first.
create index decision_escalation_timers_due_idx
  on ouroboros.decision_escalation_timers (due_at, id)
  where fired_at is null and cancelled_at is null;

-- The foreign key's own read, and a workspace's timers.
create index decision_escalation_timers_organization_idx
  on ouroboros.decision_escalation_timers (organization_id, decision_item_id);

create function ouroboros.decision_escalation_timers_settled_fixed() returns trigger
language plpgsql
as $$
begin
  if old.fired_at is not null or old.cancelled_at is not null then
    raise exception
      'the escalation timer of decision item % has ended and stays ended',
      old.decision_item_id
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'See V135__decision_escalation_timers.sql (#538).';
  end if;

  if new.decision_item_id is distinct from old.decision_item_id
     or new.escalation_window is distinct from old.escalation_window
     or new.started_at is distinct from old.started_at
     or new.due_at is distinct from old.due_at then
    raise exception
      'the escalation timer of decision item % keeps the window it started with',
      old.decision_item_id
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'See V135__decision_escalation_timers.sql (#538).';
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_escalation_timers_settled_fixed() is
  'BEFORE UPDATE trigger for decision_escalation_timers (#538): a fired or cancelled timer never changes — so a cancelled timer cannot fire — and a pending one keeps its item, window and due instant.';

create trigger decision_escalation_timers_settled_fixed
  before update on ouroboros.decision_escalation_timers
  for each row execute function ouroboros.decision_escalation_timers_settled_fixed();

create trigger decision_escalation_timers_touch_updated_at
  before update on ouroboros.decision_escalation_timers
  for each row execute function ouroboros.touch_updated_at();

-- No delete: a timer goes with its item, and its ending is the record of what happened.
grant select, insert, update on ouroboros.decision_escalation_timers to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 4. The window, the start and the firing
-- ---------------------------------------------------------------------------
create function ouroboros.decision_escalation_window(
  p_organization_id text,
  p_kind_id         text,
  p_kind_version    integer
) returns interval
language sql
stable
as $$
  select coalesce(
    (select o.escalation_window
       from ouroboros.decision_escalation_overrides o
      where o.organization_id = p_organization_id and o.kind_id = p_kind_id),
    (select k.escalation_window
       from ouroboros.decision_kinds k
      where k.kind_id = p_kind_id and k.version = p_kind_version))
$$;

comment on function ouroboros.decision_escalation_window(text, text, integer) is
  'How long an unanswered item of a kind waits in a workspace before it escalates (#538): the workspace''s override, else the window of the kind version given. Null when the workspace has no override and the kind version does not exist.';

create function ouroboros.decision_escalation_timer_start(p_decision_item_id uuid)
returns timestamptz
language plpgsql
as $$
declare
  v_due timestamptz;
begin
  insert into ouroboros.decision_escalation_timers
    (organization_id, decision_item_id, kind_id, escalation_window, started_at, due_at)
  select i.organization_id, i.id, i.kind_id, w.escalation_window, i.created_at,
         i.created_at + w.escalation_window
    from ouroboros.decision_items i
   cross join lateral (
     select ouroboros.decision_escalation_window(i.organization_id, i.kind_id, i.kind_version)
              as escalation_window) w
   where i.id = p_decision_item_id
     and i.status = 'open'
     and i.escalated_at is null
     and w.escalation_window is not null
  on conflict (decision_item_id) do nothing;

  select t.due_at into v_due
    from ouroboros.decision_escalation_timers t
   where t.decision_item_id = p_decision_item_id
     and t.fired_at is null and t.cancelled_at is null;

  return v_due;
end;
$$;

comment on function ouroboros.decision_escalation_timer_start(uuid) is
  'Start the escalation timer of an open decision item, once (#538): due at the item''s filing instant plus decision_escalation_window. Returns when the item''s pending timer is due — the new one or the one it already had — or null when none is pending (the item is not open, already escalated, or its timer has ended).';

create function ouroboros.decision_escalation_fire(
  p_timer_id uuid,
  p_at       timestamptz default now()
) returns boolean
language plpgsql
as $$
declare
  v_item uuid;
begin
  update ouroboros.decision_escalation_timers t
     set fired_at = p_at
   where t.id = p_timer_id
     and t.fired_at is null and t.cancelled_at is null
     and t.due_at <= p_at
  returning t.decision_item_id into v_item;

  if v_item is null then
    return false;
  end if;

  update ouroboros.decision_items i
     set escalated_at = p_at
   where i.id = v_item and i.escalated_at is null;

  update ouroboros.chat_messages m
     set escalated_at = p_at
   where m.decision_item_id = v_item
     and m.kind = 'decision_card' and m.state = 'open'
     and m.escalated_at is null;

  return true;
end;
$$;

comment on function ouroboros.decision_escalation_fire(uuid, timestamptz) is
  'Fire a due, pending escalation timer (#538): stamps the timer, the item''s escalated_at and each of its open decision cards'' escalated_at, together. Returns false — and changes nothing — for a timer that is not due, has already fired, or was cancelled.';

grant execute on function ouroboros.decision_escalation_window(text, text, integer) to ouroboros_app;
grant execute on function ouroboros.decision_escalation_timer_start(uuid) to ouroboros_app;
grant execute on function ouroboros.decision_escalation_fire(uuid, timestamptz) to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 5. An item that stops waiting cancels its timer
-- ---------------------------------------------------------------------------
create function ouroboros.decision_items_cancel_escalation() returns trigger
language plpgsql
as $$
begin
  if old.status = 'open' and new.status <> 'open' then
    update ouroboros.decision_escalation_timers t
       set cancelled_at = now(),
           cancel_reason = case new.status
                             when 'resolved' then 'resolved'
                             when 'snoozed'  then 'snoozed'
                             else 'withdrawn'
                           end
     where t.decision_item_id = new.id
       and t.fired_at is null and t.cancelled_at is null;
  end if;
  return null;
end;
$$;

comment on function ouroboros.decision_items_cancel_escalation() is
  'AFTER UPDATE OF status trigger for decision_items (#538): an item that leaves open — answered, snoozed or expired — cancels its pending escalation timer in the same transaction, so nothing has to hear about it for the timer never to fire.';

create trigger decision_items_cancel_escalation
  after update of status on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_cancel_escalation();
